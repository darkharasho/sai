(function () {
  const post = (msg) => {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  };
  const term = new Terminal({
    fontFamily: 'Menlo, monospace', fontSize: 12,
    theme: { background: '#0e1114', foreground: '#bec6d0', cursor: '#c7910c' },
    convertEol: true, cursorBlink: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('t'));
  fit.fit();
  post({ type: 'ready', cols: term.cols, rows: term.rows });
  term.onData((d) => post({ type: 'input', data: d }));
  window.addEventListener('resize', () => {
    fit.fit();
    post({ type: 'resize', cols: term.cols, rows: term.rows });
  });
  document.addEventListener('message', handleNative);
  window.addEventListener('message', handleNative);
  function handleNative(ev) {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'data') term.write(m.data);
    else if (m.type === 'clear') term.clear();
    else if (m.type === 'fit') { fit.fit(); post({ type: 'resize', cols: term.cols, rows: term.rows }); }
  }
})();
