"use client";

import { useEffect, useState } from "react";
import { Check, Play, Square } from "lucide-react";
import { WHISPER_MODEL_OPTIONS } from "@/lib/voice/whisper-models";
import {
  loadTtsPreferences,
  saveTtsPreferences,
  resolveVoice,
  type TtsPreferences,
} from "@/lib/voice/tts-preferences";
import { cn } from "@/lib/utils";

const PREVIEW_TEXT = "This is what this voice sounds like.";

export function VoiceSettings({
  whisperModel,
  onSaveWhisperModel,
  saving,
}: {
  whisperModel: string;
  onSaveWhisperModel: (modelId: string) => void;
  saving?: boolean;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [prefs, setPrefs] = useState<TtsPreferences>(loadTtsPreferences());
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    function refreshVoices() {
      setVoices(window.speechSynthesis.getVoices());
    }
    refreshVoices();
    // Chrome (and others) load voices asynchronously — an empty list on
    // the first call is normal, not a sign nothing is available.
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refreshVoices);
  }, []);

  function updatePrefs(patch: Partial<TtsPreferences>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveTtsPreferences(next);
  }

  function preview() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    if (previewing) {
      setPreviewing(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(PREVIEW_TEXT);
    const voice = resolveVoice(voices, prefs.voiceName);
    if (voice) utterance.voice = voice;
    utterance.rate = prefs.rate;
    utterance.pitch = prefs.pitch;
    utterance.onend = () => setPreviewing(false);
    utterance.onerror = () => setPreviewing(false);
    setPreviewing(true);
    window.speechSynthesis.speak(utterance);
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="text-xs text-paper-300 font-medium mb-2">Speech-to-text (the mic button)</h3>
        <p className="text-xs text-paper-400 mb-3 leading-relaxed">
          Which Whisper variant runs locally in your browser when you dictate a
          prompt. Smaller/English-only is faster; base models are a bit more
          accurate; multilingual variants also handle languages other than
          English. Switching this downloads the new model the next time you
          use the mic — it doesn't affect a model you've already loaded this
          session until you refresh.
        </p>
        <div className="flex flex-col gap-2">
          {WHISPER_MODEL_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => onSaveWhisperModel(opt.id)}
              disabled={saving}
              className={cn(
                "text-left rounded-lg border px-4 py-2.5 transition-colors disabled:opacity-60",
                whisperModel === opt.id
                  ? "border-brass-400/60 bg-brass-400/5"
                  : "border-ink-600 hover:border-ink-500 bg-ink-800"
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex items-center justify-center h-4 w-4 rounded-full border shrink-0",
                    whisperModel === opt.id ? "border-brass-400 bg-brass-400" : "border-ink-600"
                  )}
                >
                  {whisperModel === opt.id && (
                    <Check size={10} className="text-ink-950" strokeWidth={3} />
                  )}
                </span>
                <span className="text-sm text-paper-200 font-medium">{opt.label}</span>
                <span className="text-xs text-paper-400">{opt.detail}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs text-paper-300 font-medium mb-2">
          Text-to-speech (the speaker button on an answer)
        </h3>
        <p className="text-xs text-paper-400 mb-3 leading-relaxed">
          Your browser's own built-in voices — this list and the audio itself
          come entirely from your device, not from this app or any server.
          Saved on this browser only, since a voice available here might not
          exist on a different one.
        </p>

        <div className="flex flex-col gap-3 max-w-md">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-paper-400">Voice</span>
            <select
              value={prefs.voiceName ?? ""}
              onChange={(e) => updatePrefs({ voiceName: e.target.value || null })}
              className="text-sm bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-paper-200 outline-none focus:border-brass-400/60"
            >
              <option value="">Browser/OS default</option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} {v.lang ? `(${v.lang})` : ""}
                </option>
              ))}
            </select>
            {voices.length === 0 && (
              <span className="text-[11px] text-paper-400">
                No voices reported yet — some browsers load this list a moment
                after the page opens.
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-paper-400">Speed — {prefs.rate.toFixed(1)}x</span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={prefs.rate}
              onChange={(e) => updatePrefs({ rate: Number(e.target.value) })}
              className="accent-brass-400"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-paper-400">Pitch — {prefs.pitch.toFixed(1)}</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={prefs.pitch}
              onChange={(e) => updatePrefs({ pitch: Number(e.target.value) })}
              className="accent-brass-400"
            />
          </label>

          <button
            onClick={preview}
            className="flex items-center gap-1.5 self-start text-xs border border-ink-600 rounded-lg px-3 py-1.5 text-paper-300 hover:border-brass-400/50 transition-colors"
          >
            {previewing ? <Square size={11} fill="currentColor" /> : <Play size={11} />}
            {previewing ? "Stop" : "Preview"}
          </button>
        </div>
      </section>
    </div>
  );
}
