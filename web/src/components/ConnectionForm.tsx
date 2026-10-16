import { useEffect, useState } from 'react';
import { api, type ApiFormat, type ConnectionTest, type Settings, type SettingsPatch } from '../api';

const FORMATS: { value: ApiFormat; label: string; path: string; example: string }[] = [
  { value: 'openai', label: 'OpenAI', path: '/chat/completions', example: 'https://api.openai.com/v1' },
  { value: 'codex', label: 'Codex', path: '/responses', example: 'https://api.openai.com/v1' },
  { value: 'claude', label: 'Claude', path: '/messages', example: 'https://api.anthropic.com' },
];

/** Service URL + API key. The saved key is never shown; leaving the field empty keeps it. */
export function ConnectionForm({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [format, setFormat] = useState<ApiFormat>(settings.format);
  const [apiKey, setApiKey] = useState('');
  const [result, setResult] = useState<ConnectionTest | 'running' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setBaseUrl(settings.baseUrl), [settings.baseUrl]);
  useEffect(() => setFormat(settings.format), [settings.format]);

  const dirty = baseUrl.trim() !== settings.baseUrl || apiKey.trim() !== '' || format !== settings.format;
  const unsaved = { baseUrl: baseUrl.trim(), format, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) };
  const formatInfo = FORMATS.find((f) => f.value === format)!;

  async function test() {
    setResult('running');
    setResult(await api.testConnection(unsaved).catch((e) => ({ ok: false as const, error: (e as Error).message })));
  }

  async function save(patch: SettingsPatch = unsaved) {
    setSaving(true);
    setError('');
    try {
      const next = await api.saveSettings(patch);
      setApiKey('');
      onSaved(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="connection"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="field">
        <span id="format-label">接口格式</span>
        <div className="segmented" role="radiogroup" aria-labelledby="format-label">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={format === f.value}
              className={format === f.value ? 'on' : ''}
              onClick={() => {
                setFormat(f.value);
                setResult(null);
              }}
            >
              {f.label}
            </button>
          ))}
          <span className="faint format-path">POST …{formatInfo.path}</span>
        </div>
      </div>
      <label>
        <span>服务地址</span>
        <input
          value={baseUrl}
          onChange={(e) => {
            setBaseUrl(e.target.value);
            setResult(null);
          }}
          placeholder={`${settings.defaultBaseUrl}，或 ${formatInfo.example}`}
          spellCheck={false}
          inputMode="url"
        />
      </label>
      <label>
        <span>API Key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setResult(null);
          }}
          placeholder={settings.apiKeySet ? `已保存 ${settings.apiKeyHint}，留空则保持不变` : '未设置（magpie 本地接口不需要）'}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <div className="connection-actions">
        <span className="connection-status">
          {result === 'running' && <span className="faint">连接中…</span>}
          {result && result !== 'running' && (result.ok ? (
            <span className="ok">连接成功，{(result.ms / 1000).toFixed(1)} 秒，找到 {result.count} 个模型</span>
          ) : (
            <span className="error" title={result.error}>连接失败：{result.error}</span>
          ))}
          {error && <span className="error">{error}</span>}
        </span>
        {settings.apiKeySet && (
          <button type="button" className="link-btn inline" onClick={() => confirm('清除已保存的 API Key？') && save({ apiKey: '' })}>
            清除 Key
          </button>
        )}
        {settings.baseUrl !== settings.defaultBaseUrl && (
          <button type="button" className="link-btn inline" onClick={() => save({ baseUrl: '' })}>
            恢复默认地址
          </button>
        )}
        <button type="button" className="btn" onClick={test} disabled={result === 'running'}>测试连接</button>
        <button type="submit" className="btn primary" disabled={!dirty || saving}>{saving ? '保存中…' : '保存'}</button>
      </div>
    </form>
  );
}
