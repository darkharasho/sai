/**
 * Page-side functions, kept as source strings so the service worker can hand
 * them to CDP `Runtime.evaluate` and so unit tests can eval + call them
 * directly against a jsdom document.
 *
 * Both are *function expressions*. Callers wrap them:
 *   '(' + SNAPSHOT_FN_SOURCE + ')(' + JSON.stringify(opts) + ')'
 *
 * Constraints: no template literals (they would collide with the wrapping), no
 * imports, no reliance on anything outside the page's own globals.
 */

/**
 * Builds a compact accessibility-flavoured snapshot of the page: one entry per
 * element worth talking about, each with a stable `ref` the (future) drive
 * slice can act on. Refs are stashed on window.__saiRefs so a later
 * click/type call can resolve e17 back to a live node without re-walking.
 */
export const SNAPSHOT_FN_SOURCE = `function (opts) {
  opts = opts || {};
  var maxElements = opts.maxElements || 200;
  var maxNameLen = opts.maxNameLen || 120;

  var INTERACTIVE = 'a[href],button,input,select,textarea,summary,[role],[onclick],[contenteditable=""],[contenteditable="true"],[tabindex]:not([tabindex="-1"])';
  var STRUCTURAL = 'h1,h2,h3,h4,h5,h6,label,[aria-live]';

  var TAG_ROLES = {
    A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox',
    SUMMARY: 'disclosure', LABEL: 'label', H1: 'heading', H2: 'heading',
    H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
    NAV: 'navigation', MAIN: 'main', FORM: 'form'
  };
  var INPUT_ROLES = {
    checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button',
    reset: 'button', range: 'slider', file: 'file', image: 'button'
  };

  function clip(s) {
    s = String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    return s.length > maxNameLen ? s.slice(0, maxNameLen - 1) + '\\u2026' : s;
  }

  function roleOf(el) {
    var explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return clip(explicit);
    if (el.tagName === 'INPUT') {
      var t = (el.getAttribute('type') || 'text').toLowerCase();
      return INPUT_ROLES[t] || 'textbox';
    }
    return TAG_ROLES[el.tagName] || el.tagName.toLowerCase();
  }

  function nameOf(el) {
    var byLabel = el.getAttribute && el.getAttribute('aria-label');
    if (byLabel) return clip(byLabel);

    var labelledBy = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelledBy) {
      var parts = [];
      labelledBy.split(/\\s+/).forEach(function (id) {
        var ref = document.getElementById(id);
        if (ref) parts.push(ref.textContent || '');
      });
      if (parts.length) return clip(parts.join(' '));
    }

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      if (el.labels && el.labels.length) {
        var fromLabel = clip(el.labels[0].textContent);
        if (fromLabel) return fromLabel;
      }
      var ph = el.getAttribute('placeholder');
      if (ph) return clip(ph);
      var inputType = (el.getAttribute('type') || '').toLowerCase();
      if (inputType === 'submit' || inputType === 'button' || inputType === 'reset') {
        if (el.value) return clip(el.value);
      }
    }

    if (el.tagName === 'IMG') {
      var alt = el.getAttribute('alt');
      if (alt) return clip(alt);
    }

    var own = clip(el.textContent);
    if (own) return own;

    var title = el.getAttribute && el.getAttribute('title');
    return title ? clip(title) : '';
  }

  function visible(el) {
    if (!el.getClientRects || el.getClientRects().length === 0) return false;
    var style = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    if (!style) return true;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (style.display === 'none') return false;
    if (style.opacity === '0') return false;
    return true;
  }

  function boxOf(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }

  var refs = [];
  var out = [];
  var seen = new Set();
  var truncated = false;

  function collect(selector, kind) {
    var nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (err) {
      return;
    }
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (seen.has(el)) continue;
      seen.add(el);
      if (out.length >= maxElements) { truncated = true; return; }
      if (!visible(el)) continue;

      var role = roleOf(el);
      var name = nameOf(el);
      // A structural element with no accessible name tells the model nothing.
      if (!name && kind === 'structural') continue;

      refs.push(el);
      var entry = { ref: 'e' + refs.length, role: role, name: name, box: boxOf(el) };
      if (kind === 'interactive') entry.interactive = true;
      if (el.disabled === true) entry.disabled = true;
      if (el.checked === true) entry.checked = true;
      if (el.tagName === 'A' && el.getAttribute('href')) entry.href = clip(el.getAttribute('href'));
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        var type = (el.getAttribute('type') || '').toLowerCase();
        // Never exfiltrate what the user typed into a credential field.
        entry.value = type === 'password' ? '\\u2022\\u2022\\u2022' : clip(el.value);
      }
      out.push(entry);
    }
  }

  collect(INTERACTIVE, 'interactive');
  collect(STRUCTURAL, 'structural');

  // The generation stamp is what makes acting on a ref safe. A navigation
  // wipes these globals and a re-snapshot bumps the stamp, so an action
  // carrying an older refGen can be rejected instead of silently landing on
  // whatever element now happens to sit at that index.
  window.__saiRefs = refs;
  window.__saiRefGen = (window.__saiRefGen || 0) + 1;

  return {
    url: location.href,
    title: document.title,
    refGen: window.__saiRefGen,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
    elements: out,
    truncated: truncated
  };
}`;

/**
 * Resolves a snapshot `ref` back to a live node and reports where it sits in
 * the viewport, so the service worker can aim real CDP input events at it.
 *
 * Every failure mode here is a refusal rather than a guess. Acting on the
 * wrong element is far worse than not acting: a stale ref after a re-render
 * could mean clicking "Delete" when the model meant "Download". So a
 * generation mismatch, a detached node, a zero-sized box, or an element
 * scrolled off-screen all return `{ error }` and the caller re-snapshots.
 */
export const RESOLVE_FN_SOURCE = `function (opts) {
  opts = opts || {};
  var refs = window.__saiRefs;
  var gen = window.__saiRefGen || 0;

  if (!refs || !refs.length) {
    return { error: 'no snapshot refs on this page — call browser_snapshot first' };
  }
  if (opts.refGen && opts.refGen !== gen) {
    return { error: 'refs are stale (page changed since snapshot ' + opts.refGen + ', now ' + gen + ') — re-snapshot first' };
  }

  var m = /^e(\\d+)$/.exec(String(opts.ref || ''));
  if (!m) return { error: 'bad ref: ' + opts.ref + ' (expected e1, e2, ...)' };

  var el = refs[parseInt(m[1], 10) - 1];
  if (!el) return { error: 'unknown ref: ' + opts.ref };
  if (!el.isConnected) return { error: 'element ' + opts.ref + ' is no longer in the page — re-snapshot first' };
  if (el.disabled === true) return { error: 'element ' + opts.ref + ' is disabled' };

  if (opts.scrollIntoView !== false) {
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (err) { /* older engines */ }
  }

  var r = el.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) {
    return { error: 'element ' + opts.ref + ' has no size (hidden?) — re-snapshot first' };
  }

  var x = r.left + r.width / 2;
  var y = r.top + r.height / 2;
  // Input events are delivered by coordinate, so an off-screen centre would
  // land on whatever is actually there instead.
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
    return { error: 'element ' + opts.ref + ' is outside the viewport after scrolling — re-snapshot first' };
  }

  // 'value' in el is true for <button>, <select>, checkboxes and more, so it
  // is useless as an "can I type here" test. Go by tag and input type.
  var NON_TEXT_INPUT = {
    checkbox: 1, radio: 1, submit: 1, button: 1, reset: 1,
    file: 1, image: 1, range: 1, color: 1
  };
  var inputType = el.tagName === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : '';
  // isContentEditable is the real API (it accounts for inheritance), but the
  // attribute is checked too so this works outside a full layout engine.
  var ceAttr = el.getAttribute ? el.getAttribute('contenteditable') : null;
  var isCE = el.isContentEditable === true || ceAttr === '' || ceAttr === 'true';
  var editable = el.tagName === 'TEXTAREA' ||
    isCE ||
    (el.tagName === 'INPUT' && !NON_TEXT_INPUT[inputType]);

  if (opts.focus) {
    try { el.focus({ preventScroll: true }); } catch (err) { /* not focusable */ }
  }
  if (opts.clear && editable) {
    try {
      if (isCE) el.textContent = '';
      else el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (err) { /* read-only field */ }
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    tag: el.tagName,
    editable: editable,
    url: location.href,
    title: document.title
  };
}`;

/**
 * Scrolls the window (or a ref'd element into view) and reports the result.
 * Separate from RESOLVE so plain "scroll down the page" needs no snapshot.
 */
export const SCROLL_FN_SOURCE = `function (opts) {
  opts = opts || {};
  var before = Math.round(window.scrollY);

  if (opts.to === 'top') window.scrollTo(0, 0);
  else if (opts.to === 'bottom') window.scrollTo(0, document.body.scrollHeight);
  else window.scrollBy(opts.dx || 0, opts.dy || 0);

  var after = Math.round(window.scrollY);
  return {
    url: location.href,
    title: document.title,
    scroll: { x: Math.round(window.scrollX), y: after },
    moved: after !== before,
    atBottom: Math.ceil(after + window.innerHeight) >= document.body.scrollHeight
  };
}`;

/** Current location, for same-origin checks and post-action reporting. */
export const LOCATION_FN_SOURCE = `function () {
  return { url: location.href, origin: location.origin, title: document.title, readyState: document.readyState };
}`;

/**
 * Extracts readable text from the page or a single selector. Deliberately
 * boring: innerText with whitespace collapsed and a hard cap, so a long page
 * can't blow out the model's context.
 */
export const READ_FN_SOURCE = `function (opts) {
  opts = opts || {};
  var maxChars = opts.maxChars || 20000;
  var root = document.body;

  if (opts.selector) {
    try {
      root = document.querySelector(opts.selector);
    } catch (err) {
      return { error: 'invalid selector: ' + opts.selector };
    }
    if (!root) return { error: 'no element matched: ' + opts.selector };
  }

  var raw = root ? (root.innerText || root.textContent || '') : '';
  var text = String(raw)
    .replace(/[ \\t]+/g, ' ')
    .replace(/\\n{3,}/g, '\\n\\n')
    .trim();

  var truncated = text.length > maxChars;
  if (truncated) text = text.slice(0, maxChars);

  return {
    url: location.href,
    title: document.title,
    selector: opts.selector || null,
    text: text,
    truncated: truncated
  };
}`;
