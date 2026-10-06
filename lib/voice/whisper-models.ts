// Just the Whisper model constants — no server-only imports (no @/db, no
// drizzle) — so this is safe to import from both server code
// (lib/rag/settings.ts) and client components (VoiceInputButton, the
// Settings screen). lib/rag/settings.ts itself pulls in the database
// client, so importing *that* from a client component would try to bundle
// server-only code (and likely fail, or at minimum bloat the browser
// bundle with code that can never run there) — this file exists
// specifically so neither side needs to do that.

export const DEFAULT_WHISPER_MODEL = "Xenova/whisper-tiny.en";

// Kept to a short, deliberately curated list rather than any arbitrary
// Hugging Face model id — these are the ones actually verified to exist
// as ONNX-converted Xenova mirrors compatible with the in-browser
// automatic-speech-recognition pipeline; an arbitrary id could point at a
// model that doesn't have the needed ONNX weights at all.
export const WHISPER_MODEL_OPTIONS = [
  { id: "Xenova/whisper-tiny.en", label: "Tiny (English only)", detail: "Fastest, ~40MB" },
  { id: "Xenova/whisper-base.en", label: "Base (English only)", detail: "More accurate, ~75MB" },
  { id: "Xenova/whisper-tiny", label: "Tiny (multilingual)", detail: "Fastest multilingual, ~40MB" },
  { id: "Xenova/whisper-base", label: "Base (multilingual)", detail: "More accurate multilingual, ~75MB" },
] as const;

export const WHISPER_MODEL_IDS = WHISPER_MODEL_OPTIONS.map((m) => m.id);
