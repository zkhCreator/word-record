import { speak } from '../speak';

export function SpeakButton({ text, label = '朗读' }: { text: string; label?: string }) {
  return (
    <button type="button" className="speak" onClick={() => speak(text)} title={`${label}：${text}`} aria-label={label}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <path d="M3 8v4h3l4 3.5v-11L6 8H3z" fill="currentColor" />
        <path d="M13 7a4 4 0 0 1 0 6M15.2 4.8a7 7 0 0 1 0 10.4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </svg>
    </button>
  );
}
