export interface Choice {
  label: string;
  value: unknown;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generate SAI-authored form HTML for a message + a row of choice buttons. Each
 * button carries its value JSON-encoded in `data-sai-value`; an appended script
 * wires every button to window.saiSubmit(parsedValue). The message and labels
 * are HTML-escaped; values are JSON-encoded then attribute-escaped — no
 * injection from the caller's strings. Throws if `choices` is empty.
 */
export function buildChoiceHtml(input: { message: string; choices: Choice[] }): string {
  if (!input.choices || input.choices.length === 0) {
    throw new Error('buildChoiceHtml requires at least one choice');
  }
  const buttons = input.choices
    .map((c) => {
      const dataVal = escapeHtml(JSON.stringify(c.value));
      return (
        `<button type="button" data-sai-value="${dataVal}" ` +
        `style="padding:8px 16px;margin:4px 6px 0 0;border:1px solid #2e3d4e;border-radius:8px;` +
        `background:#1b1f27;color:#cdd3df;font:600 13px system-ui;cursor:pointer">` +
        `${escapeHtml(c.label)}</button>`
      );
    })
    .join('');
  const script =
    '<script>document.querySelectorAll(\'[data-sai-value]\').forEach(function(b){' +
    'b.addEventListener(\'click\',function(){window.saiSubmit(JSON.parse(b.getAttribute(\'data-sai-value\')));});' +
    '});<\/script>';
  return (
    `<div style="font:14px system-ui,sans-serif;color:#e6e6e6;padding:14px">` +
    `<div style="margin-bottom:10px">${escapeHtml(input.message)}</div>` +
    `<div>${buttons}</div></div>${script}`
  );
}
