const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Renders `text` with every occurrence of any `terms` wrapped in a marker highlight. */
export function Highlight({ text, terms }: { text: string; terms: (string | null | undefined)[] }) {
  const patterns = [...new Set(terms.filter((t): t is string => !!t && t.trim().length > 0).map((t) => t.trim()))]
    .sort((a, b) => b.length - a.length)
    .map((t) => escapeRe(t).replace(/\s+/g, '\\s+'));
  if (!patterns.length) return <>{text}</>;
  // Word-ish boundaries so "run" does not light up inside "brunch".
  const re = new RegExp(`(?<![\\p{L}])(${patterns.join('|')})(?![\\p{L}])`, 'giu');
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <mark key={i} className="hl">{part}</mark> : part))}
    </>
  );
}
