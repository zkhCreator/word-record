import { DEFAULT_SERVER, getServer } from './shared.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function load() {
  const server = await getServer();
  $('server').value = server === DEFAULT_SERVER ? '' : server;
  try {
    const res = await fetch(`${server}/api/entries?limit=5`);
    const { items, total } = await res.json();
    $('status').textContent = '已连接';
    $('status').className = 'status ok';
    const stats = await fetch(`${server}/api/review/stats`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    $('stats').innerHTML = `<span><b>${total}</b>条记录</span>` + (stats ? `<span><b>${stats.due}</b>待复习</span>` : '');
    $('recent').innerHTML = items.length
      ? items.map((e) => `<li><span class="t">${esc(e.lemma || e.text)}</span><span class="m">${esc(e.meaning || '')}</span></li>`).join('')
      : '<li class="empty">还没有记录。在网页上选中单词，右键即可记录。</li>';
  } catch {
    $('status').textContent = '未连接';
    $('status').className = 'status down';
    $('recent').innerHTML = '<li class="empty">本地服务未启动：在项目目录运行 <code>npm start</code></li>';
  }
}

$('open').addEventListener('click', async () => chrome.tabs.create({ url: await getServer() }));
$('review').addEventListener('click', async () => chrome.tabs.create({ url: `${await getServer()}/review` }));
$('server').addEventListener('change', async (e) => {
  const value = e.target.value.trim();
  await chrome.storage.sync.set({ serverUrl: value || DEFAULT_SERVER });
  load();
});

load();
