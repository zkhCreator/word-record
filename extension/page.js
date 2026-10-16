// Functions injected into the page with chrome.scripting.executeScript.
// Each must be fully self-contained: no closures over module scope.

export function captureContext() {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  const base = { text, sentence: '', url: location.href, title: document.title };
  if (!sel || !sel.rangeCount || !text) return base;

  const range = sel.getRangeAt(0);
  let node = range.commonAncestorContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  const BLOCK = /^(P|LI|DD|DT|TD|TH|H[1-6]|BLOCKQUOTE|PRE|FIGCAPTION|CAPTION|ARTICLE|SECTION|DIV|BODY)$/;
  while (node && !BLOCK.test(node.tagName)) node = node.parentElement;
  node = node || document.body;

  const before = document.createRange();
  before.setStart(node, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const full = node.textContent || '';
  const start = before.toString().length;
  const end = Math.min(full.length, start + range.toString().length);

  const terminator = (i) =>
    /[.!?。！？;；]/.test(full[i]) && (i + 1 >= full.length || /[\s"'”’)\]]/.test(full[i + 1]));
  let s = start;
  while (s > 0 && full[s - 1] !== '\n' && !terminator(s - 1)) s--;
  let e = end;
  while (e < full.length && full[e] !== '\n' && !terminator(e)) e++;
  if (e < full.length && full[e] !== '\n') e++;

  // Very long "sentences" (lists, unpunctuated blocks): keep a window around the selection.
  const MAX = 500;
  if (e - s > MAX) {
    const pad = Math.max(0, Math.floor((MAX - (end - start)) / 2));
    s = Math.max(s, start - pad);
    e = Math.min(e, end + pad);
  }
  return { ...base, sentence: full.slice(s, e).replace(/\s+/g, ' ').trim() };
}

export function showToast(state) {
  const HOST_ID = 'word-record-toast-host';
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px;';
    host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(host);
  }
  const root = host.shadowRoot;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let body = '';
  if (state.status === 'loading') {
    body = `<div class="term">${esc(state.text)}</div><div class="muted"><span class="dot"></span>正在记录并解析语境…</div>`;
  } else if (state.status === 'error') {
    body = `<div class="term">${esc(state.text || 'Word Record')}</div><div class="err">${esc(state.message)}</div>`;
  } else {
    const { entry, context, created } = state;
    const form = context?.form || entry.text;
    const lemma = entry.lemma && entry.lemma.toLowerCase() !== form.toLowerCase()
      ? `<span class="lemma">→ ${esc(entry.lemma)}</span>` : '';
    const meaning = context?.meaning || entry.meaning;
    body = `
      <div class="head"><span class="term">${esc(form)}</span>${lemma}
        <span class="badge">${state.merged ? '已归入' : created ? '已记录' : '新语境'}</span></div>
      <div class="sub">${esc(entry.phonetic)} <i>${esc(entry.pos)}</i></div>
      ${meaning ? `<div class="meaning">${esc(meaning)}</div>` : ''}
      ${context?.explanation ? `<div class="muted">${esc(context.explanation)}</div>` : ''}
      ${entry.enrich_status === 'error' ? `<div class="err">已保存，但解析失败：${esc(entry.enrich_error)}</div>` : ''}`;
  }

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .card { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; color: #1e2b4a;
        background: #fbfbf8; border: 1px solid #d9dce3; border-radius: 14px; padding: 14px 16px 14px 18px;
        width: 320px; box-shadow: 0 12px 32px rgba(30, 43, 74, .16); position: relative;
        border-left: 4px solid #ffe066; animation: in .22s ease-out; }
      @media (prefers-color-scheme: dark) {
        .card { color: #e4e7ee; background: #1c2230; border-color: #2c3445; border-left-color: #e6c54f; }
        .muted, .sub { color: #a5adc0 !important; }
      }
      @keyframes in { from { opacity: 0; transform: translateY(8px); } }
      .head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; padding-right: 18px; }
      .term { font: 600 18px/1.3 "Iowan Old Style", Charter, Georgia, serif; }
      .lemma { color: #5d6782; font-weight: 500; }
      .badge { margin-left: auto; font-size: 11px; color: #1e2b4a; background: #ffe066; border-radius: 999px; padding: 0 7px; }
      .sub { color: #5d6782; font-size: 12.5px; margin-top: 2px; }
      .meaning { font-size: 15px; font-weight: 600; margin-top: 8px; }
      .muted { color: #5d6782; font-size: 12.5px; margin-top: 4px; }
      .err { color: #b3261e; font-size: 12.5px; margin-top: 6px; }
      .close { position: absolute; top: 8px; right: 10px; border: 0; background: none; color: inherit; opacity: .5; cursor: pointer; font-size: 16px; }
      .close:hover { opacity: 1; }
      .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #e6c54f; margin-right: 7px;
        animation: pulse 1s infinite alternate; }
      @keyframes pulse { to { opacity: .25; } }
    </style>
    <div class="card"><button class="close" title="关闭">×</button>${body}</div>`;

  const close = () => host.remove();
  root.querySelector('.close').addEventListener('click', close);
  clearTimeout(host._timer);
  if (state.status !== 'loading') {
    const arm = () => { host._timer = setTimeout(close, state.status === 'error' ? 8000 : 6500); };
    root.querySelector('.card').addEventListener('mouseenter', () => clearTimeout(host._timer));
    root.querySelector('.card').addEventListener('mouseleave', arm);
    arm();
  }
}
