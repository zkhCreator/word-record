const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Single words also match common inflections: run -> runs/running, make -> making, study -> studied. */
function termPattern(term: string) {
  if (/\s/.test(term) || term.length < 3) return escapeRe(term).replace(/\s+/g, '\\s+');
  const forms = [escapeRe(term) + '(?:s|es|ed|d|ing|er|est)?'];
  if (term.endsWith('e')) forms.push(escapeRe(term.slice(0, -1)) + '(?:ing|ed|er|est)');
  if (term.endsWith('y')) forms.push(escapeRe(term.slice(0, -1)) + '(?:ies|ied|ier|iest)');
  // Doubled final consonant: run -> running, stop -> stopped.
  if (/[^aeiou][aeiou][bdgklmnprt]$/.test(term)) forms.push(escapeRe(term + term.slice(-1)) + '(?:ing|ed|er|est)');
  return `(?:${forms.join('|')})`;
}

/** Renders `text` with every occurrence of any `terms` wrapped in a marker highlight. */
export function Highlight({ text, terms }: { text: string; terms: (string | null | undefined)[] }) {
  const patterns = [...new Set(terms.filter((t): t is string => !!t && t.trim().length > 0).map((t) => t.trim()))]
    .sort((a, b) => b.length - a.length)
    .map(termPattern);
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
