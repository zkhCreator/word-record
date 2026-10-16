import type { ApiFormat, ConnectionTest, Settings } from '../api';

const FORMATS: { value: ApiFormat; label: string; path: string; example: string }[] = [
  { value: 'openai', label: 'OpenAI', path: '/chat/completions', example: 'https://api.openai.com/v1' },
  { value: 'codex', label: 'Codex', path: '/responses', example: 'https://api.openai.com/v1' },
  { value: 'claude', label: 'Claude', path: '/messages', example: 'https://api.anthropic.com' },
];

export interface ConnectionValues {
  format: ApiFormat;
  baseUrl: string;
  /** Newly typed key; empty keeps the saved one unless clearKey is set. */
  apiKey: string;
  clearKey: boolean;
}

interface Props {
  settings: Settings;
  value: ConnectionValues;
  onChange: (patch: Partial<ConnectionValues>) => void;
  status: ConnectionTest | 'running' | null;
}

/** Format, URL and key. Editing them reloads the model list below; nothing is saved until the page's save bar. */
export function ConnectionForm({ settings, value, onChange, status }: Props) {
  const formatInfo = FORMATS.find((f) => f.value === value.format)!;
  const keyPlaceholder = value.clearKey
    ? '保存后会清除已保存的 Key'
    : settings.apiKeySet
      ? `已保存 ${settings.apiKeyHint}，留空则保持不变`
      : '未设置（magpie 本地接口不需要）';

  return (
    <div className="connection">
      <div className="field">
        <span id="format-label">接口格式</span>
        <div className="segmented" role="radiogroup" aria-labelledby="format-label">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={value.format === f.value}
              className={value.format === f.value ? 'on' : ''}
              onClick={() => onChange({ format: f.value })}
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
          value={value.baseUrl}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
          placeholder={`${settings.defaultBaseUrl}，或 ${formatInfo.example}`}
          spellCheck={false}
          inputMode="url"
        />
      </label>
      <label>
        <span>API Key</span>
        <input
          type="password"
          value={value.apiKey}
          onChange={(e) => onChange({ apiKey: e.target.value, clearKey: false })}
          placeholder={keyPlaceholder}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <div className="connection-actions">
        <span className="connection-status">
          {status === 'running' && <span className="faint">连接中…</span>}
          {status && status !== 'running' && (status.ok ? (
            <span className="ok">已连接，{(status.ms / 1000).toFixed(1)} 秒，下面是这个服务的 {status.count} 个模型</span>
          ) : (
            <span className="error" title={status.error}>连接失败：{status.error}</span>
          ))}
        </span>
        {settings.apiKeySet && !value.clearKey && (
          <button type="button" className="link-btn inline" onClick={() => onChange({ apiKey: '', clearKey: true })}>
            清除 Key
          </button>
        )}
        {value.baseUrl.trim() !== settings.defaultBaseUrl && (
          <button type="button" className="link-btn inline" onClick={() => onChange({ baseUrl: settings.defaultBaseUrl })}>
            恢复默认地址
          </button>
        )}
      </div>
    </div>
  );
}
