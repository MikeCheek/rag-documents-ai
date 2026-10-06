// Stored in the browser, not the server — available system voices differ
// per device/browser, so a "preferred voice" saved server-side (like the
// LLM model or Whisper variant are) might not even exist on a different
// machine. Voice name is stored rather than an index, since the array
// getVoices() returns isn't guaranteed to stay in the same order between
// browser sessions.

export type TtsPreferences = {
  voiceName: string | null; // null = browser/OS default voice
  rate: number; // 0.5 - 2, SpeechSynthesisUtterance default is 1
  pitch: number; // 0 - 2, default is 1
};

const STORAGE_KEY = "reading-room:tts-preferences";

export const DEFAULT_TTS_PREFERENCES: TtsPreferences = {
  voiceName: null,
  rate: 1,
  pitch: 1,
};

export function loadTtsPreferences(): TtsPreferences {
  if (typeof window === "undefined") return DEFAULT_TTS_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TTS_PREFERENCES;
    const parsed = JSON.parse(raw);
    return {
      voiceName: typeof parsed.voiceName === "string" ? parsed.voiceName : null,
      rate: typeof parsed.rate === "number" ? parsed.rate : 1,
      pitch: typeof parsed.pitch === "number" ? parsed.pitch : 1,
    };
  } catch {
    return DEFAULT_TTS_PREFERENCES;
  }
}

export function saveTtsPreferences(prefs: TtsPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can fail (private browsing, quota, disabled) — the
    // preference just won't persist across reloads, not worth surfacing
    // as an error for something this low-stakes.
  }
}

/**
 * Resolves the saved voice preference against the browser's *current*
 * list of available voices — the saved name might no longer exist (a
 * different browser profile, a voice pack removed) in which case this
 * falls back to the browser/OS default rather than throwing or silently
 * producing no audio.
 */
export function resolveVoice(
  voices: SpeechSynthesisVoice[],
  voiceName: string | null
): SpeechSynthesisVoice | null {
  if (!voiceName) return null;
  return voices.find((v) => v.name === voiceName) ?? null;
}
