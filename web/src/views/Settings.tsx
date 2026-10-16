import { useEffect, useMemo, useState } from 'react';
import { api, type ModelInfo, type ModelTest, type Settings } from '../api';

const PROVIDER_NAMES: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  antigravity: 'Antigravity',
  kiro: 'Kiro',
};

function formatContext(n: number | null) {
  if (!n) return '';
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M 上下文` : `${Math.round(n / 1000)}K 上下文`;
}

export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [tests, setTests] = useState<Record<string, ModelTest | 'running'>>({});
  const [custom, setCustom] = useState('');

  useEffect(() => {
    api.settings().then(setSettings, (e) => setError(e.message));
    api.models().then((r) => setModels(r.items), (e) => setError(e.message));
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, ModelInfo[]>();
    for (const m of models ?? []) map.set(m.provider, [...(map.get(m.provider) ?? []), m]);
    return [...map];
  }, [models]);

  async function choose(model: string) {
    if (!model || model === settings?.model) return;
    setSaving(model);
    try {
      setSettings(await api.saveSettings({ model }));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('');
    }
  }

  async function test(model: string) {
    setTests((t) => ({ ...t, [model]: 'running' }));
    try {
      const r = await api.testModel(model);
      setTests((t) => ({ ...t, [model]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [model]: { ok: false, model, ms: 0, error: (e as Error).message } }));
    }
  }

  const current = settings?.model;
  const currentInfo = models?.find((m) => m.id === current);
  const listed = models?.some((m) => m.id === current);

  return (
    <div className="settings">
      <header className="settings-head">
        <h1>解析模型</h1>
        <p className="faint">
          新记录和「重新解析」会使用这个模型，通过 magpie 的本地接口 <code>{settings?.magpieUrl ?? '…'}</code> 调用。已有的解析结果不会变。
        </p>
        {current && (
          <div className="current-model">
            <span className="faint">当前</span>
            <strong>{currentInfo?.name ?? current}</strong>
            <code>{current}</code>
            {current !== settings?.defaultModel && (
              <button className="link-btn inline" onClick={() => choose(settings!.defaultModel)}>
                恢复默认（{settings!.defaultModel}）
              </button>
            )}
          </div>
        )}
        {models && current && !listed && <p className="error">当前模型不在 magpie 的模型列表里，解析可能会失败。</p>}
      </header>

      {error && <p className="error">{error}</p>}
      {!models && !error && <p className="faint">正在读取 magpie 模型列表…</p>}

      {groups.map(([provider, list]) => (
        <section key={provider} className="model-group">
          <h2>{PROVIDER_NAMES[provider] ?? provider}</h2>
          <ul className="model-list" role="radiogroup" aria-label={provider}>
            {list.map((m) => {
              const t = tests[m.id];
              const selected = m.id === current;
              return (
                <li key={m.id} className={`model-row ${selected ? 'selected' : ''}`}>
                  <label>
                    <input
                      type="radio"
                      name="model"
                      checked={selected}
                      disabled={!!saving}
                      onChange={() => choose(m.id)}
                    />
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

      {models && (
        <section className="model-group">
          <h2>其他模型 ID</h2>
          <form
            className="custom-model"
            onSubmit={(e) => {
              e.preventDefault();
              choose(custom.trim());
            }}
          >
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="例如 claude/claude-sonnet-5-5" />
            <button type="button" className="btn" disabled={!custom.trim()} onClick={() => test(custom.trim())}>测试</button>
            <button type="submit" className="btn primary" disabled={!custom.trim()}>使用</button>
          </form>
          {custom.trim() && tests[custom.trim()] && tests[custom.trim()] !== 'running' && (
            <p className={(tests[custom.trim()] as ModelTest).ok ? 'ok' : 'error'}>
              {(tests[custom.trim()] as ModelTest).ok ? '可用' : `不可用：${(tests[custom.trim()] as { error: string }).error}`}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
