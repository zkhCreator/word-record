import { useEffect, useState } from 'react';
import { api, type Context, type Entry } from '../api';
import { hostname, shortDate } from '../format';
import { Highlight } from './Highlight';
import { SpeakButton } from './SpeakButton';

interface Props {
  id: number;
  onChanged: (entry: Entry) => void;
  onDeleted: (id: number) => void;
}

export function EntryDetail({ id, onChanged, onDeleted }: Props) {
  const [data, setData] = useState<{ entry: Entry; contexts: Context[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    api.get(id).then(
      (d) => alive && (setData(d), setNotes(d.entry.notes)),
      (e) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) return <div className="sheet sheet-empty"><p>{error}</p></div>;
  if (!data) return <div className="sheet sheet-loading" aria-busy="true" />;

  const { entry, contexts } = data;
  const headword = entry.lemma || entry.text;
  const showForm = entry.lemma && entry.lemma.toLowerCase() !== entry.text.toLowerCase();
  const terms = [entry.text, entry.lemma];

  async function reEnrich() {
    setBusy(true);
    try {
      const d = await api.enrich(entry.id);
      setData(d);
      onChanged(d.entry);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes() {
    if (notes === entry.notes) return;
    const { entry: updated } = await api.update(entry.id, { notes });
    setData((d) => d && { ...d, entry: updated });
    onChanged(updated);
  }

  async function removeEntry() {
    if (!confirm(`删除「${headword}」及其全部语境？`)) return;
    await api.remove(entry.id);
    onDeleted(entry.id);
  }

  async function removeContext(ctx: Context) {
    if (!confirm('删除这条语境？')) return;
    await api.removeContext(ctx.id);
    setData((d) => d && { ...d, contexts: d.contexts.filter((c) => c.id !== ctx.id) });
  }

  return (
    <article className="sheet" key={entry.id}>
      <header className="headword-block">
        <h1 className={`headword ${headword.length > 18 ? 'long' : ''}`}>{headword}</h1>
        <div className="pron">
          {entry.phonetic && <span className="ipa">{entry.phonetic}</span>}
          <SpeakButton text={headword} />
          {entry.pos && <span className="pos">{entry.pos}</span>}
        </div>
        {showForm && (
          <p className="form-note">
            原文写作 <em>{entry.text}</em>
            {entry.form_note && <span>。{entry.form_note}</span>}
          </p>
        )}
        {entry.meaning && <p className="meaning">{entry.meaning}</p>}
        {entry.definition_en && <p className="definition">{entry.definition_en}</p>}
      </header>

      {entry.enrich_status !== 'done' && (
        <div className={`notice ${entry.enrich_status}`}>
          <span>
            {entry.enrich_status === 'pending' ? '还没有解析结果。' : `解析失败：${entry.enrich_error ?? '未知错误'}`}
            请确认 magpie 正在运行。
          </span>
          <button className="btn" onClick={reEnrich} disabled={busy}>{busy ? '解析中…' : '重新解析'}</button>
        </div>
      )}

      <section className="block">
        <h2>语境 <span className="count">{contexts.length}</span></h2>
        <ol className="contexts">
          {contexts.map((c) => (
            <li key={c.id} className="context">
              <blockquote className="sentence">
                {c.sentence ? <Highlight text={c.sentence} terms={terms} /> : <span className="faint">（没有记录到句子）</span>}
              </blockquote>
              {c.translation && <p className="translation">{c.translation}</p>}
              {(c.meaning || c.explanation) && (
                <p className="gloss">
                  {c.meaning && <strong>{c.meaning}</strong>}
                  {c.explanation && <span>{c.explanation}</span>}
                </p>
              )}
              <footer className="source">
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer" title={c.url}>
                    {c.title || hostname(c.url)}
                  </a>
                ) : (
                  <span>手动添加</span>
                )}
                {c.url && c.title && <span className="faint">{hostname(c.url)}</span>}
                <span className="faint">{shortDate(c.created_at)}</span>
                <button className="link-btn" onClick={() => removeContext(c)}>删除</button>
              </footer>
            </li>
          ))}
        </ol>
      </section>

      {entry.senses.length > 0 && (
        <section className="block">
          <h2>常见释义</h2>
          <dl className="senses">
            {entry.senses.map((s, i) => (
              <div key={i}>
                <dt>{s.pos}</dt>
                <dd>{s.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {entry.examples.length > 0 && (
        <section className="block">
          <h2>例句</h2>
          <ul className="examples">
            {entry.examples.map((ex, i) => (
              <li key={i}>
                <p className="ex-en">
                  <span><Highlight text={ex.en} terms={terms} /></span>
                  <SpeakButton text={ex.en} label="朗读例句" />
                </p>
                <p className="ex-zh">{ex.zh}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="block">
        <h2>笔记</h2>
        <textarea
          className="notes"
          value={notes}
          placeholder="写下联想、词根或容易混淆的词……离开输入框时自动保存"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          rows={3}
        />
      </section>

      <footer className="sheet-actions">
        <span className="faint">首次记录于 {shortDate(entry.created_at)}</span>
        <button className="btn" onClick={reEnrich} disabled={busy}>{busy ? '解析中…' : '重新解析'}</button>
        <button className="btn danger" onClick={removeEntry}>删除</button>
      </footer>
    </article>
  );
}
