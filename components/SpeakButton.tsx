"use client";

import { Volume2, VolumeX } from "lucide-react";

/**
 * Text-to-speech via the browser's built-in SpeechSynthesis API —
 * genuinely local (the OS/browser's own voices, no network call for
 * playback), and deliberately not a bundled neural TTS model: unlike
 * Whisper for speech-to-text, in-browser neural TTS support in the
 * transformers.js ecosystem is far less mature, and the built-in API
 * already does exactly this job reliably with zero extra weight.
 */
export function SpeakButton({
  isSpeaking,
  onToggle,
  className,
}: {
  isSpeaking: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={className ?? "p-1 rounded hover:bg-ink-700 text-paper-400 hover:text-paper-200 transition-colors"}
      aria-label={isSpeaking ? "Stop reading aloud" : "Read aloud"}
      title={isSpeaking ? "Stop reading aloud" : "Read aloud"}
    >
      {isSpeaking ? <VolumeX size={13} className="text-brass-300" /> : <Volume2 size={13} />}
    </button>
  );
}
