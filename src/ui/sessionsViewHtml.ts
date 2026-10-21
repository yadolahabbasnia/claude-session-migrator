/**
 * The sidebar webview's markup, styles and script, kept apart from the provider so the provider
 * stays about data and commands. The embedded script deliberately has no backticks or `${`
 * (it lives inside a template literal) and builds DOM with textContent rather than innerHTML for
 * anything that comes from disk, so session text can never inject markup. Inline `style=`
 * attributes are blocked by the CSP, so dynamic styling goes through the CSSOM instead.
 */
export function renderSessionsViewHtml(nonce: string, cspSource: string): string {
  const csp = [
    `default-src 'none'`,
    `img-src ${cspSource} data:`,
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude Migrator</title>
<style nonce="${nonce}">
  :root {
    --gap: 10px;
    --radius: 8px;
    --muted: var(--vscode-descriptionForeground);
    --border: color-mix(in srgb, var(--vscode-foreground) 14%, transparent);
    --surface: color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
    --surface-hover: color-mix(in srgb, var(--vscode-foreground) 9%, transparent);
    --accent: var(--vscode-textLink-foreground);
    --ok: var(--vscode-testing-iconPassed, #3fb27f);
    --warn: var(--vscode-editorWarning-foreground, #d9a441);
    --bad: var(--vscode-errorForeground, #f14c4c);
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0 0 24px; font-family: var(--vscode-font-family); font-size: 12.5px; line-height: 1.4; color: var(--vscode-foreground); }
  button { font: inherit; color: inherit; cursor: pointer; border: none; background: none; padding: 0; }
  svg { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .wrap { padding: 0 var(--gap); display: flex; flex-direction: column; gap: var(--gap); }

  /* header */
  .top { display: flex; align-items: center; gap: 8px; padding: 12px var(--gap) 4px; }
  .logo { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, #d97757, #b5546a); }
  .logo svg { width: 16px; height: 16px; stroke: #fff; }
  .top .titles { flex: 1; min-width: 0; }
  .title { font-weight: 600; font-size: 13px; letter-spacing: 0.1px; }
  .sub { color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .icon-btn { width: 26px; height: 26px; border-radius: 6px; display: grid; place-items: center; color: var(--muted); }
  .icon-btn:hover { background: var(--surface-hover); color: var(--vscode-foreground); }
  .icon-btn.spin svg { animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* busy bar */
  .busy { display: none; align-items: center; gap: 8px; margin: 0 var(--gap); padding: 6px 10px; border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 11px; }
  .busy.on { display: flex; }
  .busy .bar { width: 28px; height: 3px; border-radius: 2px; background: var(--border); position: relative; overflow: hidden; flex: none; }
  .busy .bar::after { content: ''; position: absolute; inset: 0; width: 40%; background: var(--accent); border-radius: 2px; animation: slide 1.1s ease-in-out infinite; }
  @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(260%); } }
  .busy .msg { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .err { display: none; margin: 0 var(--gap); padding: 6px 10px; border-radius: 6px; color: var(--bad); background: color-mix(in srgb, var(--bad) 12%, transparent); font-size: 11px; }
  .err.on { display: block; }

  /* cards */
  .card { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
  .card-head { display: flex; align-items: center; gap: 6px; padding: 9px 10px 0; flex-wrap: wrap; }
  .grow { flex: 1; }
  .pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.3px; text-transform: uppercase; background: var(--surface-hover); color: var(--muted); }
  .pill .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .pill.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
  .pill.warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
  .pill.bad { color: var(--bad); background: color-mix(in srgb, var(--bad) 14%, transparent); }
  .pill.live .dot { animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  .hero { padding: 8px 10px 10px; }
  .hero .big { font-size: 15px; font-weight: 600; }
  .hero .small { color: var(--muted); font-size: 11.5px; margin-top: 2px; }
  .flags { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
  .flag { display: flex; gap: 6px; align-items: flex-start; font-size: 11.5px; padding: 5px 8px; border-radius: 6px; }
  .flag.bad { color: var(--bad); background: color-mix(in srgb, var(--bad) 12%, transparent); }
  .flag.warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 12%, transparent); }
  .flag.info { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .flag span { min-width: 0; word-break: break-word; }
  .details { display: none; border-top: 1px solid var(--border); padding: 6px 10px; }
  .card.open .details { display: block; }
  .kv { display: grid; grid-template-columns: 86px 1fr; gap: 3px 8px; padding: 4px 0; align-items: baseline; }
  .kv .k { color: var(--muted); font-size: 11px; }
  .kv .v { min-width: 0; word-break: break-word; }
  .kv .v.mono { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; }
  .kv .v .tag { display: inline-block; font-size: 10.5px; padding: 0 6px; border-radius: 4px; background: var(--surface-hover); color: var(--muted); margin-left: 4px; }
  .kv .v .good { color: var(--ok); }
  .kv .v .badtxt { color: var(--bad); }
  .kv .v .warntxt { color: var(--warn); }
  .arch { display: flex; flex-direction: column; gap: 6px; }
  .arch .row { display: flex; flex-direction: column; gap: 1px; }
  .arch .row .nm { word-break: break-all; }
  .arch .row .mt { color: var(--muted); font-size: 11px; }
  .link { color: var(--accent); }
  .link:hover { text-decoration: underline; }
  .card-actions { display: flex; gap: 6px; padding: 8px 10px 10px; flex-wrap: wrap; border-top: 1px solid var(--border); }
  .toggle { display: flex; align-items: center; gap: 4px; color: var(--muted); font-size: 11px; padding: 2px 4px; border-radius: 4px; }
  .toggle:hover { color: var(--vscode-foreground); background: var(--surface-hover); }
  .toggle svg { transition: transform 0.15s; }
  .card.open .toggle svg { transform: rotate(180deg); }

  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: 500; background: var(--surface-hover); border: 1px solid var(--border); }
  .btn:hover { background: color-mix(in srgb, var(--vscode-foreground) 14%, transparent); }
  .btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
  .btn.primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn.danger { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, transparent); background: transparent; }
  .btn.danger:hover { background: color-mix(in srgb, var(--bad) 14%, transparent); }
  .btn.ghost { background: transparent; border-color: transparent; color: var(--muted); }
  .btn.ghost:hover { color: var(--vscode-foreground); background: var(--surface-hover); }
  .btn.sm { padding: 3px 8px; font-size: 11px; }

  /* stats */
  .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
  .stat { border: 1px solid var(--border); background: var(--surface); border-radius: var(--radius); padding: 6px 7px; min-width: 0; }
  .stat .n { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stat .l { color: var(--muted); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .actions .btn { padding: 7px 10px; }

  .tools .card-head { padding-bottom: 9px; cursor: pointer; }
  .tools .card-head .ttl { font-weight: 600; }
  .tools .body { display: none; border-top: 1px solid var(--border); padding: 4px 6px 8px; }
  .tools.open .body { display: block; }
  .tools.open .toggle svg { transform: rotate(180deg); }
  .tools .grp { padding: 6px 4px 2px; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
  .tool { display: flex; width: 100%; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; text-align: left; }
  .tool:hover { background: var(--surface-hover); }
  .tool .t1 { display: block; }
  .tool .t2 { display: block; color: var(--muted); font-size: 10.5px; }
  .tool svg { color: var(--muted); }
  .notice { display: none; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--radius); border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); background: color-mix(in srgb, var(--warn) 10%, transparent); font-size: 11.5px; }
  .notice.on { display: flex; }
  .notice .grow { min-width: 0; }

  /* projects */
  .section-head { display: flex; align-items: center; gap: 8px; padding-top: 2px; }
  .section-head h3 { margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); font-weight: 600; flex: none; }
  .search { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--vscode-input-background, transparent); color: var(--muted); }
  .search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--vscode-input-foreground, var(--vscode-foreground)); font: inherit; }
  .search:focus-within { border-color: var(--vscode-focusBorder); }
  .proj { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
  .proj.expanded { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
  .proj-main { display: flex; gap: 10px; padding: 9px 10px; cursor: pointer; align-items: flex-start; }
  .proj-main:hover { background: var(--surface-hover); }
  .avatar { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; font-weight: 700; font-size: 13px; flex: none; }
  .proj-info { flex: 1; min-width: 0; }
  .proj-title { display: flex; align-items: center; gap: 6px; font-weight: 600; }
  .proj-title .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chev { color: var(--muted); transition: transform 0.15s; margin-top: 2px; }
  .proj.expanded .chev { transform: rotate(90deg); }
  .proj-path { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
  .proj-path bdo { direction: ltr; unicode-bidi: bidi-override; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px; font-size: 10.5px; background: var(--surface-hover); color: var(--muted); max-width: 100%; }
  .chip svg { width: 11px; height: 11px; }
  .chip.accent { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .chip.warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
  .chip .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .proj-body { display: none; border-top: 1px solid var(--border); padding: 8px 10px 10px; }
  .proj.expanded .proj-body { display: block; }
  .proj-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  .sess { display: flex; gap: 8px; align-items: flex-start; padding: 6px 4px; border-radius: 6px; cursor: pointer; }
  .sess:hover { background: var(--surface-hover); }
  .sess input { margin: 2px 0 0; flex: none; cursor: pointer; }
  .sess .txt { flex: 1; min-width: 0; }
  .sess .pv { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .sess .mt { color: var(--muted); font-size: 10.5px; margin-top: 1px; }
  .sess .del { opacity: 0; color: var(--muted); }
  .sess:hover .del { opacity: 1; }
  .sess .del:hover { color: var(--bad); }
  .selbar { display: none; gap: 6px; margin-bottom: 8px; align-items: center; }
  .proj.has-selection .selbar { display: flex; }
  .empty { text-align: center; color: var(--muted); padding: 22px 10px; border: 1px dashed var(--border); border-radius: var(--radius); }
  .empty b { display: block; color: var(--vscode-foreground); margin-bottom: 2px; }

  /* preview */
  .preview { display: none; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .preview.on { display: block; }
  .preview-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  .preview-head .nm { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .turns { padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; }
  .turn { padding: 6px 8px; border-radius: 6px; background: var(--surface-hover); }
  .turn.assistant { border-left: 2px solid var(--accent); }
  .turn .role { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--accent); }
  .turn .text { white-space: pre-wrap; word-break: break-word; margin-top: 2px; font-size: 12px; }
</style>
</head>
<body>
  <div class="top">
    <div class="logo"><svg viewBox="0 0 24 24"><path d="M7 7h10M7 12h10M7 17h6"/><path d="M17 15l3 2-3 2"/></svg></div>
    <div class="titles">
      <div class="title">Claude Migrator</div>
      <div class="sub" id="profile">Claude Code sessions</div>
    </div>
    <button class="icon-btn" id="refresh" title="Refresh"><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button>
  </div>

  <div class="busy" id="busy"><div class="bar"></div><div class="msg" id="busyMsg"></div></div>
  <div class="err" id="err"></div>

  <div class="wrap">
    <section class="card" id="syncCard"></section>

    <div class="stats" id="stats"></div>

    <div class="actions">
      <button class="btn primary" id="exportAll"><svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 15v4h14v-4"/></svg>Export</button>
      <button class="btn" id="importSessions"><svg viewBox="0 0 24 24"><path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>Import</button>
    </div>

    <div class="notice" id="backupNotice">
      <svg viewBox="0 0 24 24"><path d="M4 7h16v4H4zM6 11v8h12v-8M10 15h4"/></svg>
      <div class="grow" id="backupMsg"></div>
      <button class="btn sm" id="mergeBackups">Merge</button>
    </div>

    <section class="card tools" id="tools"></section>

    <div class="section-head">
      <h3 id="projHead">Projects</h3>
      <label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/></svg><input id="filter" type="text" placeholder="Filter projects"></label>
    </div>
    <div id="list"></div>

    <div class="preview" id="preview">
      <div class="preview-head"><div class="nm" id="previewTitle"></div><button class="icon-btn" id="previewClose" title="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="turns" id="turns"></div>
    </div>
  </div>

<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  var saved = vscode.getState() || {};
  var state = {
    projects: [], sessionsRoot: '', sync: null, backups: 0, filter: '',
    detailsOpen: saved.detailsOpen === true,
    toolsOpen: saved.toolsOpen === true,
    expanded: saved.expanded || {}
  };
  function persist() { vscode.setState({ detailsOpen: state.detailsOpen, toolsOpen: state.toolsOpen, expanded: state.expanded }); }

  var I = {
    chev: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    sync: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 13.5-5.8L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-13.5 5.8L4 16"/><path d="M4 20v-4h4"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M5 6h14v9H10l-4 3v-3H5z"/></svg>',
    disk: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    brain: '<svg viewBox="0 0 24 24"><path d="M9 5a3 3 0 0 0-3 3v1a3 3 0 0 0 0 6v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3 0zM15 5a3 3 0 0 1 3 3v1a3 3 0 0 1 0 6v1a3 3 0 0 1-6 0"/></svg>',
    git: '<svg viewBox="0 0 24 24"><circle cx="7" cy="6" r="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="9" r="2"/><path d="M7 8v8M17 11c0 3-4 3-8 6"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v9H4z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  function h(tag, props, kids) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === undefined || v === null || v === false) { return; }
        if (k === 'class') { el.className = v; }
        else if (k === 'text') { el.textContent = v; }
        else if (k === 'icon') { el.insertAdjacentHTML('afterbegin', v); }
        else if (k.slice(0, 2) === 'on') { el.addEventListener(k.slice(2), v); }
        else { el.setAttribute(k, v === true ? '' : v); }
      });
    }
    (kids || []).forEach(function (c) {
      if (c === undefined || c === null || c === false) { return; }
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  function $(id) { return document.getElementById(id); }
  function post(command, extra) { var m = { command: command }; if (extra) { Object.keys(extra).forEach(function (k) { m[k] = extra[k]; }); } vscode.postMessage(m); }

  function fmtBytes(b) {
    if (b === undefined || b === null) { return '-'; }
    if (b < 1024) { return b + ' B'; }
    if (b < 1048576) { return (b / 1024).toFixed(1) + ' KB'; }
    if (b < 1073741824) { return (b / 1048576).toFixed(1) + ' MB'; }
    return (b / 1073741824).toFixed(2) + ' GB';
  }
  function ago(iso) {
    if (!iso) { return 'never'; }
    var s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 0) { s = 0; }
    if (s < 45) { return 'just now'; }
    var m = Math.round(s / 60);
    if (m < 60) { return m + ' min ago'; }
    var hr = Math.round(m / 60);
    if (hr < 24) { return hr + ' h ago'; }
    var d = Math.round(hr / 24);
    if (d < 30) { return d + ' d ago'; }
    return new Date(iso).toLocaleDateString();
  }
  function timeEl(iso, prefix) {
    var el = h('span', { text: (prefix || '') + ago(iso), title: iso ? new Date(iso).toLocaleString() : '' });
    if (iso) { el.setAttribute('data-ago', iso); if (prefix) { el.setAttribute('data-prefix', prefix); } }
    return el;
  }
  function shortRemote(url) {
    if (!url) { return ''; }
    var u = url.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@\/]+@/, '').replace(/:/, '/').replace(/\.git$/i, '');
    return u;
  }
  function hue(name) { var x = 0; for (var i = 0; i < name.length; i++) { x = (x * 31 + name.charCodeAt(i)) % 360; } return x; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* ---------- sync card ---------- */
  function renderSync() {
    var s = state.sync;
    var card = $('syncCard');
    card.textContent = '';
    if (!s) { return; }

    var rt = s.runtime || {};
    var gitMode = s.mode === 'git';
    card.className = 'card' + (state.detailsOpen ? ' open' : '');

    // pills
    var head = h('div', { class: 'card-head' });
    head.appendChild(h('span', { class: 'pill ' + (gitMode ? 'ok' : ''), icon: '' }, [h('span', { class: 'dot' }), gitMode ? 'Git sync' : 'Local only']));
    if (gitMode) {
      var autoPill;
      if (!s.autoSync) { autoPill = h('span', { class: 'pill' }, ['Auto-sync off']); }
      else if (rt.watcher === 'syncing') { autoPill = h('span', { class: 'pill warn live' }, [h('span', { class: 'dot' }), 'Syncing']); }
      else if (rt.watcher === 'pending') { autoPill = h('span', { class: 'pill warn live' }, [h('span', { class: 'dot' }), 'Change detected']); }
      else if (rt.lastAuto && !rt.lastAuto.ok) { autoPill = h('span', { class: 'pill bad' }, [h('span', { class: 'dot' }), 'Auto-sync error']); }
      else { autoPill = h('span', { class: 'pill ok live' }, [h('span', { class: 'dot' }), 'Auto-sync on']); }
      head.appendChild(autoPill);
    }
    head.appendChild(h('span', { class: 'grow' }));
    head.appendChild(h('button', { class: 'toggle', title: 'Show details', onclick: function () { state.detailsOpen = !state.detailsOpen; persist(); renderSync(); } }, [state.detailsOpen ? 'Less' : 'Details', h('span', { icon: I.down })]));
    card.appendChild(head);

    // hero
    var hero = h('div', { class: 'hero' });
    var commit = s.repo && s.repo.lastCommit;
    if (!s.configured) {
      hero.appendChild(h('div', { class: 'big', text: 'Not syncing yet' }));
      hero.appendChild(h('div', { class: 'small', text: 'Back up sessions and share them across machines through a private git repository.' }));
    } else if (!s.checkoutExists || !s.repo) {
      hero.appendChild(h('div', { class: 'big', text: 'Repository not cloned' }));
      hero.appendChild(h('div', { class: 'small', text: 'Run Sync now to clone ' + shortRemote(s.repoUrl) + '.' }));
    } else if (!gitMode) {
      hero.appendChild(h('div', { class: 'big', text: 'Git sync is paused' }));
      hero.appendChild(h('div', { class: 'small', text: 'Using local sessions only. ' + shortRemote(s.repoUrl) + ' is kept so you can resume any time.' }));
    } else if (commit) {
      var big = h('div', { class: 'big' }, [timeEl(commit.iso, 'Last push ')]);
      hero.appendChild(big);
      var isAuto = /^Auto-sync/i.test(commit.subject);
      var hostMatch = /from (\S+)/.exec(commit.subject);
      var parts = [isAuto ? 'Auto-sync' : 'Manual push'];
      if (hostMatch) { parts.push(hostMatch[1] === s.hostname ? 'this machine' : hostMatch[1]); }
      hero.appendChild(h('div', { class: 'small', text: parts.join(' · ') }));
    } else {
      hero.appendChild(h('div', { class: 'big', text: 'Nothing pushed yet' }));
      hero.appendChild(h('div', { class: 'small', text: 'Run Sync now and choose Push to send your sessions.' }));
    }
    if (gitMode && s.autoSync && rt.watcher === 'pending' && rt.nextSyncAt) {
      var secs = Math.max(0, Math.round((new Date(rt.nextSyncAt).getTime() - Date.now()) / 1000));
      hero.appendChild(h('div', { class: 'small', text: 'Auto-sync runs in ~' + secs + 's' }));
    }
    var flags = h('div', { class: 'flags' });
    if (gitMode && rt.lastAuto && !rt.lastAuto.ok) {
      flags.appendChild(h('div', { class: 'flag bad' }, [h('span', {}, ['Auto-sync failed ', timeEl(rt.lastAuto.at), ': ' + (rt.lastAuto.message || 'unknown error')])]));
    }
    if (s.repo && s.repo.ahead) {
      flags.appendChild(h('div', { class: 'flag warn' }, [h('span', { text: plural(s.repo.ahead, 'commit', 'commits') + ' not pushed yet' })]));
    }
    if (s.repo && s.repo.behind) {
      flags.appendChild(h('div', { class: 'flag info' }, [h('span', { text: plural(s.repo.behind, 'update', 'updates') + ' available from other machines -- use Sync now > Pull' })]));
    }
    if (s.repo && s.repo.uncommittedFiles) {
      flags.appendChild(h('div', { class: 'flag warn' }, [h('span', { text: plural(s.repo.uncommittedFiles, 'file', 'files') + ' in the sync checkout not committed' })]));
    }
    if (flags.childNodes.length) { hero.appendChild(flags); }
    card.appendChild(hero);

    // details
    var d = h('div', { class: 'details' });
    function row(k, v, mono) {
      var vEl = h('div', { class: 'v' + (mono ? ' mono' : '') }, Array.isArray(v) ? v : [v]);
      d.appendChild(h('div', { class: 'kv' }, [h('div', { class: 'k', text: k }), vEl]));
    }
    row('Mode', gitMode ? 'Git sync (repo is the reference)' : 'Local only');
    if (s.configured) {
      row('Repository', h('span', { text: shortRemote(s.repoUrl), title: s.repoUrl }), true);
      row('Branch', s.branch, true);
      row('Checkout', h('span', { class: 'link', text: s.localPath, title: 'Reveal in file manager', onclick: function () { post('reveal', { folderPath: s.localPath }); } }), true);
    }
    if (gitMode) {
      var auto;
      if (!s.autoSync) { auto = h('span', { class: 'warntxt', text: 'Off (setting claudeMigrator.gitSync.autoSync)' }); }
      else if (rt.watcher === 'syncing') { auto = h('span', { class: 'warntxt', text: 'Syncing now…' }); }
      else if (rt.watcher === 'pending') { auto = h('span', { class: 'warntxt', text: 'Change detected, waiting to settle' }); }
      else { auto = h('span', { class: 'good', text: 'Watching for changes' }); }
      row('Auto-sync', auto);
      if (rt.lastAuto) {
        var la = rt.lastAuto;
        var laText = la.ok ? (la.pushed ? 'pushed' : (la.message || 'nothing to push')) : ('failed: ' + (la.message || 'unknown error'));
        row('Last auto run', [h('span', { class: la.ok ? 'good' : 'badtxt', text: la.ok ? 'OK' : 'Failed' }), ' · ', timeEl(la.at), ' · ' + laText]);
      }
    }
    if (rt.lastManual) {
      var lm = rt.lastManual;
      row('Last manual', [lm.kind === 'push' ? 'Push' : 'Pull', ' · ', timeEl(lm.at), lm.message ? ' · ' + lm.message : '']);
    }
    if (s.repo) {
      var r = s.repo;
      var rs = [];
      if (r.ahead === undefined || r.behind === undefined) { rs.push(h('span', { text: 'unknown' })); }
      else if (r.ahead === 0 && r.behind === 0) { rs.push(h('span', { class: 'good', text: 'Up to date' })); }
      else {
        if (r.ahead) { rs.push(h('span', { class: 'warntxt', text: r.ahead + ' to push' })); }
        if (r.ahead && r.behind) { rs.push(' · '); }
        if (r.behind) { rs.push(h('span', { class: 'warntxt', text: r.behind + ' to pull' })); }
      }
      if (r.lastFetchedAt) { rs.push(' · checked '); rs.push(timeEl(r.lastFetchedAt)); }
      row('Remote', rs);
      row('Uncommitted', r.uncommittedFiles === 0 ? 'none' : plural(r.uncommittedFiles, 'file', 'files'));
    }
    if (s.archives && s.archives.length) {
      var list = h('div', { class: 'arch' });
      s.archives.forEach(function (a) {
        list.appendChild(h('div', { class: 'row' }, [
          h('span', { class: 'nm', text: a.fileName, title: a.fileName }),
          a.isOwn ? h('span', { class: 'tag', text: 'this machine' }) : null,
          h('span', { class: 'mt' }, [fmtBytes(a.sizeBytes) + ' · ', timeEl(a.committedAt)])
        ]));
      });
      row('Archives', list);
    }
    row('Machine', s.hostname, true);
    row('Claude home', h('span', { text: s.claudeHome, title: s.claudeHome }), true);
    if (s.profileCount > 1) { row('Profiles', plural(s.profileCount, 'Claude profile', 'Claude profiles') + ' found on this machine'); }
    card.appendChild(d);

    // actions
    var acts = h('div', { class: 'card-actions' });
    if (!s.configured) {
      acts.appendChild(h('button', { class: 'btn primary', icon: I.git, onclick: function () { post('configureGitRepo'); } }, ['Set up Git sync']));
    } else {
      acts.appendChild(h('button', { class: 'btn primary', icon: I.sync, onclick: function () { post('syncGit'); } }, ['Sync now']));
      acts.appendChild(h('button', { class: 'btn', onclick: function () { post('configureGitRepo'); } }, [gitMode ? 'Change repo' : 'Use Git sync']));
      if (gitMode) {
        acts.appendChild(h('button', { class: 'btn ghost', title: 'Turn background auto-sync on or off', onclick: function () { post('toggleAutoSync'); } }, [s.autoSync ? 'Pause auto-sync' : 'Resume auto-sync']));
        acts.appendChild(h('button', { class: 'btn ghost', onclick: function () { post('useLocalOnly'); } }, ['Local only']));
      }
    }
    card.appendChild(acts);
  }

  /* ---------- tools ---------- */
  var TOOLS = [
    ['Sessions', [
      ['undoImport', 'Remove imported items', 'Undo an import and restore the backup', I.trash],
      ['deleteSessions', 'Delete sessions...', 'Pick a project, then sessions or the whole project', I.trash],
      ['inspect', 'Inspect archive...', 'See what a .cmt file contains without importing', I.disk]
    ]],
    ['Project config (.claude)', [
      ['exportProjects', 'Export projects...', 'Scan, review and save .claude folders to a .cmt', I.chat],
      ['importBackup', 'Import backup...', 'Restore .claude folders from a .cmt', I.chat],
      ['scan', 'Scan for projects', 'Find .claude folders in a workspace or folder', I.folder],
      ['validate', 'Validate current project', 'Check this workspace .claude for problems and secrets', I.clock]
    ]]
  ];
  function renderTools() {
    var box = $('tools');
    box.textContent = '';
    box.className = 'card tools' + (state.toolsOpen ? ' open' : '');
    box.appendChild(h('div', { class: 'card-head', onclick: function () { state.toolsOpen = !state.toolsOpen; persist(); renderTools(); } }, [
      h('span', { class: 'ttl', text: 'More tools' }),
      h('span', { class: 'grow' }),
      h('span', { class: 'toggle', icon: I.down })
    ]));
    var body = h('div', { class: 'body' });
    TOOLS.forEach(function (g) {
      body.appendChild(h('div', { class: 'grp', text: g[0] }));
      g[1].forEach(function (t) {
        body.appendChild(h('button', { class: 'tool', icon: t[3], onclick: function () { post('runTool', { tool: t[0] }); } }, [
          h('span', {}, [h('span', { class: 't1', text: t[1] }), h('span', { class: 't2', text: t[2] })])
        ]));
      });
    });
    box.appendChild(body);
  }

  /* ---------- stats ---------- */
  function renderStats(stats) {
    var el = $('stats');
    el.textContent = '';
    if (!stats) { return; }
    var tiles = [
      [String(stats.projects), 'Projects'],
      [String(stats.sessions), 'Sessions'],
      [fmtBytes(stats.bytes), 'Size'],
      [null, 'Active', stats.lastActive]
    ];
    tiles.forEach(function (t) {
      var n = h('div', { class: 'n' });
      if (t[0] === null) { n.appendChild(timeEl(t[2])); } else { n.textContent = t[0]; }
      el.appendChild(h('div', { class: 'stat' }, [n, h('div', { class: 'l', text: t[1] })]));
    });
  }

  /* ---------- projects ---------- */
  function renderProjects() {
    var list = $('list');
    list.textContent = '';
    var q = state.filter.trim().toLowerCase();
    var items = state.projects.filter(function (p) {
      if (!q) { return true; }
      return (p.label + ' ' + (p.sourcePath || '') + ' ' + (p.gitRemote || '')).toLowerCase().indexOf(q) !== -1;
    });
    items.sort(function (a, b) { return b.lastModified.localeCompare(a.lastModified); });
    $('projHead').textContent = q ? ('Projects (' + items.length + '/' + state.projects.length + ')') : ('Projects (' + state.projects.length + ')');

    if (state.projects.length === 0) {
      list.appendChild(h('div', { class: 'empty' }, [h('b', { text: 'No Claude Code sessions found' }), state.sessionsRoot]));
      return;
    }
    if (items.length === 0) {
      list.appendChild(h('div', { class: 'empty' }, [h('b', { text: 'No match' }), 'Nothing matches "' + state.filter + '".']));
      return;
    }
    var wrap = h('div', { class: 'wrap-list' });
    wrap.style.setProperty('display', 'flex');
    wrap.style.setProperty('flex-direction', 'column');
    wrap.style.setProperty('gap', '8px');
    items.forEach(function (p) { wrap.appendChild(projectCard(p)); });
    list.appendChild(wrap);
  }

  function projectCard(p) {
    var open = !!state.expanded[p.id];
    var el = h('div', { class: 'proj' + (open ? ' expanded' : ''), 'data-id': p.id });

    var av = h('div', { class: 'avatar', text: (p.label.charAt(0) || '?').toUpperCase() });
    var hh = hue(p.label);
    av.style.setProperty('background', 'hsl(' + hh + ' 55% 50% / 0.22)');
    av.style.setProperty('color', 'hsl(' + hh + ' 70% 68%)');

    var chips = h('div', { class: 'chips' }, [
      h('span', { class: 'chip accent', icon: I.chat }, [plural(p.sessionCount, 'session', 'sessions')]),
      h('span', { class: 'chip', icon: I.disk }, [p.sizeLabel]),
      h('span', { class: 'chip', icon: I.clock }, [timeEl(p.lastModified)]),
      p.hasMemoryDir ? h('span', { class: 'chip', icon: I.brain }, ['memory']) : null,
      p.gitRemote ? h('span', { class: 'chip', icon: I.git, title: p.gitRemote }, [h('span', { class: 't', text: shortRemote(p.gitRemote) })]) : null,
      p.sourceKnown ? null : h('span', { class: 'chip warn' }, ['unknown source'])
    ]);

    var pathEl = h('div', { class: 'proj-path', title: p.sourceKnown ? p.sourcePath : p.folderName }, [h('bdo', { dir: 'ltr', text: p.sourceKnown ? p.sourcePath : p.folderName })]);

    var main = h('div', { class: 'proj-main', onclick: function () {
      state.expanded[p.id] = !state.expanded[p.id];
      persist();
      el.classList.toggle('expanded', !!state.expanded[p.id]);
    } }, [
      av,
      h('div', { class: 'proj-info' }, [h('div', { class: 'proj-title' }, [h('span', { class: 'nm', text: p.label })]), pathEl, chips]),
      h('span', { class: 'chev', icon: I.chev })
    ]);
    el.appendChild(main);

    var body = h('div', { class: 'proj-body' });
    var selCount = h('span', { text: '0' });
    var selbar = h('div', { class: 'selbar' }, [
      h('button', { class: 'btn danger sm', icon: I.trash, onclick: function () {
        var names = selected();
        if (names.length) { post('deleteSessions', { id: p.id, fileNames: names }); }
      } }, ['Delete selected (', selCount, ')']),
      h('button', { class: 'btn ghost sm', onclick: function () {
        body.querySelectorAll('.sess input').forEach(function (cb) { cb.checked = false; });
        update();
      } }, ['Clear'])
    ]);
    function selected() {
      return Array.prototype.filter.call(body.querySelectorAll('.sess input'), function (cb) { return cb.checked; }).map(function (cb) { return cb.closest('.sess').getAttribute('data-file'); });
    }
    function update() {
      var n = selected().length;
      selCount.textContent = String(n);
      el.classList.toggle('has-selection', n > 0);
    }

    body.appendChild(h('div', { class: 'proj-actions' }, [
      h('button', { class: 'btn sm', onclick: function () { post('exportProject', { id: p.id }); } }, ['Export']),
      h('button', { class: 'btn sm', icon: I.folder, onclick: function () { post('reveal', { folderPath: p.folderPath }); } }, ['Reveal']),
      h('button', { class: 'btn danger sm', icon: I.trash, onclick: function () { post('deleteProject', { id: p.id }); } }, ['Delete project'])
    ]));
    body.appendChild(selbar);

    p.sessions.forEach(function (s) {
      var cb = h('input', { type: 'checkbox', title: 'Select for deletion' });
      cb.addEventListener('click', function (e) { e.stopPropagation(); });
      cb.addEventListener('change', update);
      var row = h('div', { class: 'sess', 'data-file': s.fileName, onclick: function () { post('preview', { folderPath: p.folderPath, fileName: s.fileName }); } }, [
        cb,
        h('div', { class: 'txt' }, [
          h('div', { class: 'pv', text: s.preview || s.fileName }),
          h('div', { class: 'mt' }, [plural(s.messageCount, 'msg', 'msgs') + ' · ' + s.sizeLabel + ' · ', timeEl(s.lastModified)])
        ]),
        h('button', { class: 'icon-btn del', icon: I.trash, title: 'Delete this session', onclick: function (e) {
          e.stopPropagation();
          post('deleteSessions', { id: p.id, fileNames: [s.fileName] });
        } })
      ]);
      body.appendChild(row);
    });
    el.appendChild(body);
    return el;
  }

  function renderPreview(title, turns) {
    var box = $('preview');
    box.classList.add('on');
    $('previewTitle').textContent = title;
    var t = $('turns');
    t.textContent = '';
    if (!turns || turns.length === 0) {
      t.appendChild(h('div', { class: 'empty', text: 'No readable turns in this session.' }));
    } else {
      turns.forEach(function (x) {
        t.appendChild(h('div', { class: 'turn ' + x.role }, [h('div', { class: 'role', text: x.role }), h('div', { class: 'text', text: x.text })]));
      });
    }
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------- wiring ---------- */
  $('exportAll').addEventListener('click', function () { post('exportAll'); });
  $('importSessions').addEventListener('click', function () { post('importSessions'); });
  $('mergeBackups').addEventListener('click', function () { post('mergeBackups'); });
  $('refresh').addEventListener('click', function () { post('refresh'); });
  $('previewClose').addEventListener('click', function () { $('preview').classList.remove('on'); });
  $('filter').addEventListener('input', function (e) { state.filter = e.target.value; renderProjects(); });

  var busyTimer;
  function setBusy(message, done) {
    var on = !!message && done !== true;
    $('busy').classList.toggle('on', on);
    $('refresh').classList.toggle('spin', on);
    $('busyMsg').textContent = message || '';
    if (on) { clearTimeout(busyTimer); busyTimer = setTimeout(function () { setBusy('', true); }, 120000); }
  }

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (msg.command === 'projects') {
      state.projects = msg.data;
      state.sessionsRoot = msg.sessionsRoot;
      renderStats(msg.stats);
      renderProjects();
    } else if (msg.command === 'syncPanel') {
      state.sync = msg.data;
      $('profile').textContent = msg.data.claudeHome;
      renderSync();
    } else if (msg.command === 'status') {
      setBusy(msg.message, msg.done);
    } else if (msg.command === 'backupCandidates') {
      var n = msg.count;
      $('backupNotice').classList.toggle('on', n > 0);
      if (n > 0) { $('backupMsg').textContent = plural(n, 'leftover import backup', 'leftover import backups') + ' can be merged back.'; }
    } else if (msg.command === 'previewResult') {
      renderPreview(msg.title, msg.turns);
    } else if (msg.command === 'error') {
      var er = $('err');
      er.textContent = 'Error: ' + msg.message;
      er.classList.add('on');
      setTimeout(function () { er.classList.remove('on'); }, 8000);
      setBusy('', true);
    }
  });

  // keep every "x min ago" label fresh without asking the extension for anything
  setInterval(function () {
    document.querySelectorAll('[data-ago]').forEach(function (el) {
      el.textContent = (el.getAttribute('data-prefix') || '') + ago(el.getAttribute('data-ago'));
    });
    if (state.sync && state.sync.runtime && state.sync.runtime.watcher === 'pending') { renderSync(); }
  }, 15000);

  renderTools();
  post('ready');
</script>
</body>
</html>`;
}
