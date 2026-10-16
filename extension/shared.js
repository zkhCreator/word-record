export const DEFAULT_SERVER = 'http://127.0.0.1:5178';

export async function getServer() {
  const { serverUrl } = await chrome.storage.sync.get('serverUrl');
  return (serverUrl || DEFAULT_SERVER).replace(/\/+$/, '');
}
