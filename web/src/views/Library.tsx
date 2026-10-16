import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Entry } from '../api';
import { dayBucket } from '../format';
import { navigate } from '../router';
import { AddForm } from '../components/AddForm';
import { EntryDetail } from '../components/EntryDetail';

const KINDS = [
  { value: '', label: '全部' },
  { value: 'word', label: '单词' },
  { value: 'phrase', label: '短语' },
];

export function Library({ selectedId }: { selectedId: number | null }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [items, setItems] = useState<Entry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.list({ q, kind, limit: 500 });
      setItems(res.items);
      setTotal(res.total);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [q, kind]);

  useEffect(() => {
    const t = setTimeout(load, q ? 180 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  // Captures happen in other tabs; refresh when the user comes back.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  useEffect(() => {
    if (selectedId == null && items?.length && window.matchMedia('(min-width: 900px)').matches) {
      navigate(`/entry/${items[0].id}`, true);
    }
  }, [items, selectedId]);

  const groups = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of items ?? []) {
      const key = dayBucket(e.updated_at);
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map];
  }, [items]);

  const replaceItem = (entry: Entry) =>
    setItems((list) => list?.map((e) => (e.id === entry.id ? { ...e, ...entry } : e)) ?? list);

  return (
    <div className={`library ${selectedId != null ? 'has-selection' : ''}`}>
      <aside className="index">
        <div className="index-tools">
          <input
            type="search"
            className="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`在 ${total} 条记录中搜索`}
            aria-label="搜索"
          />
          <div className="filters" role="tablist">
            {KINDS.map((k) => (
              <button key={k.value} role="tab" aria-selected={kind === k.value} className={kind === k.value ? 'on' : ''} onClick={() => setKind(k.value)}>
                {k.label}
              </button>
            ))}
            <button className="add-toggle" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
              手动添加
            </button>
          </div>
          {adding && (
            <AddForm
              onClose={() => setAdding(false)}
              onAdded={(entry) => {
                setAdding(false);
                load();
                navigate(`/entry/${entry.id}`);
              }}
            />
          )}
        </div>

        {error && <p className="error pad">连接不到本地服务：{error}</p>}
        {items && items.length === 0 && !error && (
          <div className="index-empty">
            {q || kind ? <p>没有匹配的记录。</p> : (
              <>
                <p>还没有记录。</p>
                <p className="faint">安装 extension 目录下的浏览器扩展后，在任意网页选中单词，右键选择「记录到 Word Record」。</p>
              </>
            )}
          </div>
        )}
        <nav className="entries" aria-label="记录列表">
          {groups.map(([label, list]) => (
            <section key={label}>
              <h3 className="group-label">{label}</h3>
              <ul>
                {list.map((e) => (
                  <li key={e.id}>
                    <a
                      href={`/entry/${e.id}`}
                      className={`entry-row ${e.id === selectedId ? 'current' : ''}`}
                      aria-current={e.id === selectedId ? 'page' : undefined}
                      onClick={(ev) => {
                        ev.preventDefault();
                        navigate(`/entry/${e.id}`);
                      }}
                    >
                      <span className="row-word">{e.lemma || e.text}</span>
                      <span className="row-meaning">
                        {e.enrich_status === 'error' ? <span className="error">解析失败</span> : e.meaning || '…'}
                      </span>
                      {(e.context_count ?? 0) > 1 && <span className="row-count" title="语境数">{e.context_count}</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
      </aside>

      <main className="detail">
        {selectedId != null ? (
          <>
            <button className="back" onClick={() => navigate('/')}>返回列表</button>
            <EntryDetail
              id={selectedId}
              onChanged={replaceItem}
              onDeleted={(id) => {
                const rest = (items ?? []).filter((e) => e.id !== id);
                setItems(rest);
                setTotal((t) => t - 1);
                navigate(rest[0] ? `/entry/${rest[0].id}` : '/', true);
              }}
            />
          </>
        ) : (
          items && items.length > 0 && <div className="sheet sheet-empty"><p>从左侧选一个词查看。</p></div>
        )}
      </main>
    </div>
  );
}
