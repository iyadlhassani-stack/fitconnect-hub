let unlocked = false;

export function unlockVoice(lang: string): void {
  if (!('speechSynthesis' in window)) return;
  const utt = new SpeechSynthesisUtterance('');
  utt.volume = 0;
  utt.lang = lang === 'fr' ? 'fr-FR' : 'en-US';
  window.speechSynthesis.speak(utt);
  unlocked = true;
}

export function speak(text: string, lang: string): void {
  if (!('speechSynthesis' in window) || !unlocked) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = lang === 'fr' ? 'fr-FR' : 'en-US';
  utt.rate = 0.95;
  utt.volume = 1;
  window.speechSynthesis.speak(utt);
}

export function vibrate(pattern: number | number[]): void {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

export function isVoiceSupported(): boolean {
  return 'speechSynthesis' in window;
}

export function isMobile(): { ios: boolean; android: boolean } {
  const ua = navigator.userAgent;
  return {
    ios: /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream,
    android: /Android/.test(ua),
  };
}
