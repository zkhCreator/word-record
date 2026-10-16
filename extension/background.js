import { getServer } from './shared.js';
import { captureContext, showToast } from './page.js';

const MENU_ID = 'word-record-capture';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: '记录「%s」到 Word Record', contexts: ['selection'] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab?.id != null) {
    capture(tab.id, info.frameId ?? 0, info.selectionText ?? '');
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'capture-selection' && tab?.id != null) capture(tab.id, 0, '');
});

async function inject(tabId, frameId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func, args });
  return res?.result;
}

async function toast(tabId, frameId, state) {
  try {
    await inject(tabId, frameId, showToast, [state]);
  } catch {
    // Restricted pages (chrome://, Web Store, PDF viewer) cannot be scripted.
  }
}

async function capture(tabId, frameId, fallbackText) {
  let payload;
  try {
    payload = await inject(tabId, frameId, captureContext);
  } catch {
    const tab = await chrome.tabs.get(tabId);
    payload = { text: fallbackText, sentence: '', url: tab.url, title: tab.title };
  }
  if (!payload?.text) payload = { ...payload, text: fallbackText.trim() };
  if (!payload.text) return;

  await toast(tabId, frameId, { status: 'loading', text: payload.text });
  try {
    const server = await getServer();
    const res = await fetch(`${server}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    await toast(tabId, frameId, { status: 'done', ...data });
    chrome.action.setBadgeText({ text: '✓' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
  } catch (err) {
    const message = err instanceof TypeError ? '连接不到本地服务，请先运行 npm start' : err.message;
    await toast(tabId, frameId, { status: 'error', text: payload.text, message });
  }
}
