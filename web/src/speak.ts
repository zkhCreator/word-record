export function speak(text: string) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.9;
  const voice = speechSynthesis.getVoices().find((v) => v.lang === 'en-US' && /Samantha|Google US|Ava|Allison/.test(v.name));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}
