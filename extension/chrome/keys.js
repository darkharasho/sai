/**
 * Key specs for sai_browser_press: a named key ("Enter"), any single character
 * ("a", "/"), or a "+"-joined combo ("Control+a", "Shift+Tab", "Meta+Enter").
 * Pure, so it can be tested without a browser.
 */

export const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  // Space is how a focused checkbox, radio or switch is toggled — Enter does
  // not activate them, and on an app with global shortcuts it falls through to
  // the page behind instead, which is worse than doing nothing.
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
};

/**
 * The DOM name for the space key is a single space, and models reach for
 * "Spacebar" too, so both resolve to Space rather than being refused for a
 * naming mismatch. Everything else must match a key in KEYS exactly.
 */
export const KEY_ALIASES = { ' ': 'Space', Spacebar: 'Space', space: 'Space', Esc: 'Escape' };

/** CDP Input.dispatchKeyEvent modifier bits. */
const MODIFIERS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const MODIFIER_ALIASES = { Ctrl: 'Control', Cmd: 'Meta', Command: 'Meta', Option: 'Alt', Opt: 'Alt' };

function unsupported(spec) {
  return new Error(
    `unsupported key: ${spec} (named keys: ${Object.keys(KEYS).join(', ')}; any single character; ` +
    'modifiers Control, Shift, Alt, Meta joined with +, e.g. Control+a)',
  );
}

/**
 * Parses a key spec into what Input.dispatchKeyEvent needs. `text` is left
 * off when Control, Alt or Meta is held, so a shortcut doesn't also type.
 */
export function parseKeySpec(spec) {
  const raw = String(spec ?? '');
  if (!raw) throw unsupported(raw);

  // "+" alone, or a combo ending in "++", means the plus key itself.
  let parts;
  if (raw === '+') parts = ['+'];
  else if (raw.endsWith('++')) parts = [...raw.slice(0, -2).split('+'), '+'];
  else parts = raw === ' ' ? [' '] : raw.split('+');

  const keyName = parts.pop();
  let modifiers = 0;
  for (const m of parts) {
    const name = MODIFIER_ALIASES[m] || m;
    if (!(name in MODIFIERS)) throw unsupported(raw);
    modifiers |= MODIFIERS[name];
  }

  const named = KEYS[KEY_ALIASES[keyName] || keyName];
  let def;
  if (named) {
    def = { ...named };
  } else if ([...keyName].length === 1) {
    const ch = keyName;
    const upper = ch.toUpperCase();
    const isLetter = /^[a-z]$/i.test(ch);
    const isDigit = /^[0-9]$/.test(ch);
    const key = isLetter && modifiers & MODIFIERS.Shift ? upper : ch;
    def = {
      key,
      code: isLetter ? `Key${upper}` : isDigit ? `Digit${ch}` : '',
      keyCode: isLetter || isDigit ? upper.charCodeAt(0) : 0,
      text: key,
    };
  } else {
    throw unsupported(raw);
  }

  if (modifiers & (MODIFIERS.Control | MODIFIERS.Alt | MODIFIERS.Meta)) delete def.text;
  return { ...def, modifiers };
}
