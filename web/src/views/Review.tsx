import { useCallback, useEffect, useState } from 'react';
import { api, type Grade, type ReviewItem, type ReviewStats } from '../api';
import { dayLabel, formatDue, formatInterval } from '../format';
import { Link } from '../router';
import { speak } from '../speak';
import { Highlight } from '../components/Highlight';
import { SpeakButton } from '../components/SpeakButton';

const GRADE_BUTTONS: { grade: Grade; label: string; key: string }[] = [
  { grade: 'again', label: '忘了', key: '1' },
  { grade: 'hard', label: '模糊', key: '2' },
  { grade: 'good', label: '记得', key: '3' },
];

export function Review({ onReviewed }: { onReviewed: () => void }) {
  const [queue, setQueue] = useState<ReviewItem[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadStats = useCallback(() => api.reviewStats().then(setStats, () => {}), []);

  useEffect(() => {
    api.reviewQueue().then((r) => setQueue(r.items), (e) => setError(e.message));
    loadStats();
  }, [loadStats]);

  const current = queue?.[0];
  const sessionTotal = done + (queue?.length ?? 0);

  const grade = useCallback(
    async (g: Grade) => {
      if (!current || busy) return;
      setBusy(true);
      try {
        const { preview } = await api.grade(current.entry.id, g);
        setQueue((q) => {
          if (!q) return q;
          const [head, ...rest] = q;
          // A forgotten card comes back at the end of this session.
          return g === 'again' ? [...rest, { ...head, preview }] : rest;
        });
        if (g !== 'again') setDone((n) => n + 1);
        setRevealed(false);
        onReviewed();
        loadStats();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [current, busy, onReviewed, loadStats],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (!current) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed) {
        const b = GRADE_BUTTONS.find((b) => b.key === e.key);
        if (b) grade(b.grade);
      }
      if (e.key.toLowerCase() === 's') speak(current.entry.lemma || current.entry.text);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, revealed, grade]);

  if (error) return <div className="review"><p className="error">{error}</p></div>;
  if (!queue) return <div className="review" aria-busy="true" />;

  if (!current) {
    return (
      <div className="review">
        <div className="review-done">
          <h1>{done > 0 ? `这一轮复习完成了，共 ${done} 个` : '现在没有需要复习的词'}</h1>
          {stats && (
            <p className="faint">
              {stats.nextDueAt ? `下一次复习：${formatDue(stats.nextDueAt)}` : stats.total === 0 ? '先去记录一些单词吧。' : ''}
            </p>
          )}
          {stats && <Summary stats={stats} />}
          <Link to="/" className="btn">回到词库</Link>
        </div>
      </div>
    );
  }

  const { entry, contexts } = current;
  const ctx = contexts[0];
  const headword = entry.lemma || entry.text;
  const terms = [ctx?.form, entry.text, entry.lemma, ...(entry.forms ?? [])];

  return (
    <div className="review">
      <div className="review-progress" aria-label={`进度 ${done} / ${sessionTotal}`}>
        <div className="bar"><span style={{ width: `${(done / Math.max(sessionTotal, 1)) * 100}%` }} /></div>
        <span className="faint">{done} / {sessionTotal}</span>
      </div>

      <section className={`card ${revealed ? 'revealed' : ''}`} key={`${entry.id}-${current.review.reps}`}>
        <h1 className="card-word">{headword}</h1>
        {ctx?.sentence && (
          <blockquote className="card-sentence">
            <Highlight text={ctx.sentence} terms={terms} />
          </blockquote>
        )}

        {revealed ? (
          <div className="answer">
            <div className="pron">
              {entry.phonetic && <span className="ipa">{entry.phonetic}</span>}
              <SpeakButton text={headword} />
              {entry.pos && <span className="pos">{entry.pos}</span>}
            </div>
            <p className="meaning">{ctx?.meaning || entry.meaning || '（没有解析结果）'}</p>
            {ctx?.explanation && <p className="faint">{ctx.explanation}</p>}
            {ctx?.translation && <p className="translation">{ctx.translation}</p>}
            {entry.form_note && <p className="faint small">{entry.form_note}</p>}
            {entry.senses.length > 1 && (
              <p className="other-senses">
                {entry.senses.map((s, i) => (
                  <span key={i}><i>{s.pos}</i> {s.meaning}</span>
                ))}
              </p>
            )}
            <Link to={`/entry/${entry.id}`} className="card-link">查看完整词条</Link>
          </div>
        ) : (
          <p className="card-hint faint">回想它在这句话里的意思</p>
        )}
      </section>

      <div className="review-actions">
        {revealed ? (
          GRADE_BUTTONS.map((b) => (
            <button key={b.grade} className={`grade grade-${b.grade}`} onClick={() => grade(b.grade)} disabled={busy}>
              <span className="grade-label">{b.label}</span>
              <span className="grade-next">{formatInterval(current.preview[b.grade])}后</span>
              <kbd>{b.key}</kbd>
            </button>
          ))
        ) : (
          <button className="reveal" onClick={() => setRevealed(true)}>
            显示释义 <kbd>空格</kbd>
          </button>
        )}
      </div>
    </div>
  );
}

function Summary({ stats }: { stats: ReviewStats }) {
  return (
    <div className="summary">
      <dl className="summary-figures">
        <div><dt>今天已复习</dt><dd>{stats.reviewedToday}</dd></div>
        <div><dt>已掌握</dt><dd>{stats.mastered}<small> / {stats.total}</small></dd></div>
      </dl>
      <table className="forecast">
        <caption>未来 7 天待复习</caption>
        <thead>
          <tr>{stats.forecast.map((f, i) => <th key={f.day} scope="col">{dayLabel(f.day, i)}</th>)}</tr>
        </thead>
        <tbody>
          <tr>{stats.forecast.map((f) => <td key={f.day} className={f.count ? '' : 'zero'}>{f.count}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}
