import { useEffect, useState } from 'react';
import { api, type Entry } from '../api';

/** Search another entry and fold the current one into it. */
export function MergeControl({ entry, onMerged }: { entry: Entry; onMerged: (target: Entry) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Entry[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !q.trim()) return setResults([]);
    const t = setTimeout(() => {
      api.list({ q: q.trim(), limit: 8 }).then((r) => setResults(r.items.filter((e) => e.id !== entry.id)), () => {});
    }, 150);
    return () => clearTimeout(t);
  }, [q, open, entry.id]);

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)} title="把这个词条的语境和形式合并到另一个词条">
        合并到…
      </button>
    );
  }

  async function mergeInto(target: Entry) {
    const name = entry.lemma || entry.text;
    if (!confirm(`把「${name}」的全部语境合并到「${target.lemma || target.text}」？「${name}」这个词条会被删除。`)) return;
    try {
      const { entry: merged } = await api.merge(entry.id, target.id);
      onMerged(merged);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="merge">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索要合并到的词条" aria-label="搜索要合并到的词条" />
      <button className="link-btn" onClick={() => setOpen(false)}>取消</button>
      {(results.length > 0 || error) && (
        <ul className="merge-results">
          {error && <li className="error">{error}</li>}
          {results.map((r) => (
            <li key={r.id}>
              <button onClick={() => mergeInto(r)}>
                <span className="row-word">{r.lemma || r.text}</span>
                <span className="faint">{r.meaning}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
