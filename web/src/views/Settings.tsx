import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type ConnectionDraft, type ConnectionTest, type ModelInfo, type ModelTest, type Settings, type SettingsPatch } from '../api';
import { ConnectionForm, type ConnectionValues } from '../components/ConnectionForm';

const PROVIDER_NAMES: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  antigravity: 'Antigravity',
  kiro: 'Kiro',
};

const FORMAT_NAMES = { openai: 'OpenAI', codex: 'Codex', claude: 'Claude' };

function formatContext(n: number | null) {
  if (!n) return '';
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M 上下文` : `${Math.round(n / 1000)}K 上下文`;
}

const fromSettings = (s: Settings): ConnectionValues => ({ format: s.format, baseUrl: s.baseUrl, apiKey: '', clearKey: false });

/**
 * Connection and model are one draft: the model list is loaded from the connection
 * being edited, and both are saved together so they can never point at different services.
 */
export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [conn, setConn] = useState<ConnectionValues | null>(null);
  const [model, setModel] = useState('');
  const [status, setStatus] = useState<ConnectionTest | 'running' | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState<Record<string, ModelTest | 'running'>>({});
  const [custom, setCustom] = useState('');
  const loadSeq = useRef(0);

  function reset(s: Settings) {
    setSettings(s);
    setConn(fromSettings(s));
    setModel(s.model);
  }

  useEffect(() => {
    api.settings().then(reset, (e) => setError(e.message));
  }, []);

  const draft: ConnectionDraft | null = conn && {
    baseUrl: conn.baseUrl.trim(),
    format: conn.format,
    ...(conn.clearKey ? { apiKey: '' } : conn.apiKey.trim() ? { apiKey: conn.apiKey.trim() } : {}),
  };
  const draftKey = JSON.stringify(draft);

  // Reload the model list whenever the connection being edited changes (typing is debounced).
  const lastFormat = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!draft) return;
    const immediate = lastFormat.current !== draft.format;
    lastFormat.current = draft.format;
    const seq = ++loadSeq.current;
    const t = setTimeout(async () => {
      setStatus('running');
      setTests({});
      const r = await api.testConnection(draft).catch((e) => ({ ok: false as const, error: (e as Error).message }));
      if (seq === loadSeq.current) setStatus(r);
    }, immediate ? 0 : 600);
    return () => clearTimeout(t);
  }, [draftKey]);

  const models: ModelInfo[] | null = status && status !== 'running' && status.ok ? status.items : null;

  const groups = useMemo(() => {
    const map = new Map<string, ModelInfo[]>();
    for (const m of models ?? []) map.set(m.provider, [...(map.get(m.provider) ?? []), m]);
    return [...map];
  }, [models]);

  if (!settings || !conn || !draft) return <div className="settings">{error && <p className="error">{error}</p>}</div>;

  const connChanged = conn.format !== settings.format || conn.baseUrl.trim() !== settings.baseUrl || !!conn.apiKey.trim() || conn.clearKey;
  const modelChanged = model !== settings.model;
  const dirty = connChanged || modelChanged;
  const currentInfo = models?.find((m) => m.id === model);
  const missing = !!models && !currentInfo;

  async function test(id: string) {
    setTests((t) => ({ ...t, [id]: 'running' }));
    const r = await api.testModel(id, draft!).catch((e) => ({ ok: false as const, model: id, ms: 0, error: (e as Error).message }));
    setTests((t) => ({ ...t, [id]: r }));
  }

  async function save() {
    const patch: SettingsPatch = {};
    if (conn!.format !== settings!.format) patch.format = conn!.format;
    const url = conn!.baseUrl.trim();
    if (url !== settings!.baseUrl) patch.baseUrl = url === settings!.defaultBaseUrl ? '' : url;
    if (draft!.apiKey !== undefined) patch.apiKey = draft!.apiKey;
    if (modelChanged) patch.model = model;
    setSaving(true);
    try {
      reset(await api.saveSettings(patch));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const changes = [
    conn.format !== settings.format && `接口格式改为 ${FORMAT_NAMES[conn.format]}`,
    conn.baseUrl.trim() !== settings.baseUrl && '服务地址',
    (conn.apiKey.trim() || conn.clearKey) && (conn.clearKey ? '清除 API Key' : 'API Key'),
    modelChanged && `模型改为 ${currentInfo?.name ?? model}`,
  ].filter(Boolean);

  return (
    <div className="settings">
      <header className="settings-head">
        <h1>设置</h1>
      </header>

      <section className="settings-section">
        <h2 className="section-title">模型服务</h2>
        <p className="faint">
          支持 OpenAI（Chat Completions）、Codex（OpenAI Responses）和 Claude（Anthropic Messages）三种接口格式，默认是 magpie 的本地接口。修改后下面的模型列表会立刻换成这个服务的。API Key 只保存在本机数据库里，不会再发回浏览器。
        </p>
        <ConnectionForm
          settings={settings}
          value={conn}
          status={status}
          onChange={(patch) => setConn((c) => c && { ...c, ...patch })}
        />
      </section>

      <header className="settings-section">
        <h2 className="section-title">解析模型</h2>
        <p className="faint">新记录和「重新解析」会使用这个模型，已有的解析结果不会变。测试会用上面正在编辑的服务。</p>
        <div className="current-model">
          <span className="faint">{modelChanged ? '已选' : '当前'}</span>
          <strong>{currentInfo?.name ?? model}</strong>
          <code>{model}</code>
          {modelChanged && <span className="faint">（保存前仍在用 {settings.model}）</span>}
          {model !== settings.defaultModel && (
            <button className="link-btn inline" onClick={() => setModel(settings.defaultModel)}>
              恢复默认（{settings.defaultModel}）
            </button>
          )}
        </div>
        {missing && (
          <p className="error">
            这个服务的模型列表里没有 {model}，用它解析可能会失败。请在下面换一个，或在「其他模型 ID」里确认这个 ID 可用。
          </p>
        )}
      </header>

      {error && <p className="error">{error}</p>}
      {status === 'running' && !models && <p className="faint">正在读取模型列表…</p>}
      {status && status !== 'running' && !status.ok && <p className="faint">连接成功后这里会列出可选的模型。</p>}

      {groups.map(([provider, list]) => (
        <section key={provider} className="model-group">
          <h2>{PROVIDER_NAMES[provider] ?? provider}</h2>
          <ul className="model-list" role="radiogroup" aria-label={provider}>
            {list.map((m) => {
              const t = tests[m.id];
              const selected = m.id === model;
              return (
                <li key={m.id} className={`model-row ${selected ? 'selected' : ''}`}>
                  <label>
                    <input type="radio" name="model" checked={selected} onChange={() => setModel(m.id)} />
                    <span className="model-name">{m.name}</span>
                    <span className="model-meta">
                      <code>{m.id}</code>
                      {m.contextWindow && <span>{formatContext(m.contextWindow)}</span>}
                    </span>
                  </label>
                  <div className="model-test">
                    {t === 'running' ? (
                      <span className="faint">测试中…</span>
                    ) : t?.ok ? (
                      <span className="ok">可用，{(t.ms / 1000).toFixed(1)} 秒：{t.lemma} {t.meaning}</span>
                    ) : t ? (
                      <span className="error" title={t.error}>不可用：{t.error}</span>
                    ) : null}
                    <button className="btn" onClick={() => test(m.id)} disabled={t === 'running'}>测试</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className="model-group">
        <h2>其他模型 ID</h2>
        <form
          className="custom-model"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.trim()) setModel(custom.trim());
          }}
        >
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="例如 claude/claude-sonnet-5-5" />
          <button type="button" className="btn" disabled={!custom.trim()} onClick={() => test(custom.trim())}>测试</button>
          <button type="submit" className="btn" disabled={!custom.trim()}>选用</button>
        </form>
        {custom.trim() && tests[custom.trim()] && tests[custom.trim()] !== 'running' && (
          <p className={(tests[custom.trim()] as ModelTest).ok ? 'ok' : 'error'}>
            {(tests[custom.trim()] as ModelTest).ok ? '可用' : `不可用：${(tests[custom.trim()] as { error: string }).error}`}
          </p>
        )}
      </section>

      {dirty && (
        <div className="save-bar" role="region" aria-label="未保存的更改">
          <span>
            未保存：{changes.join('，')}
            {missing && <span className="error">。所选模型不在这个服务的列表里</span>}
          </span>
          <button className="btn" onClick={() => reset(settings)} disabled={saving}>放弃</button>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
        </div>
      )}
    </div>
  );
}
