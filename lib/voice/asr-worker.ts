// Runs entirely in a Web Worker, off the main thread, so transcribing
// doesn't freeze the UI. Speech-to-text via Whisper, running fully
// client-side through @xenova/transformers' WASM backend. Its runtime
// and model weights are fetched from a CDN/Hugging Face the first time
// a given model is used and cached by the browser after that — same
// "downloads once, then offline" pattern as this app's server-side
// embedding model, just running in the browser instead of Node.
//
// Which model variant to load is passed in per-message (from Settings ->
// Voice) rather than hardcoded, so switching the setting takes effect on
// the next recording without needing a page reload — the pipeline for
// each distinct model id loaded is cached here, so switching back to a
// previously-used model doesn't re-download it.

import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@xenova/transformers";

const transcribers = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>();

function getTranscriber(modelId: string): Promise<AutomaticSpeechRecognitionPipeline> {
  let existing = transcribers.get(modelId);
  if (!existing) {
    existing = pipeline("automatic-speech-recognition", modelId, {
      progress_callback: (data: any) => {
        self.postMessage({ type: "progress", data });
      },
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
    transcribers.set(modelId, existing);
  }
  return existing;
}

self.onmessage = async (event: MessageEvent) => {
  const { type, modelId } = event.data ?? {};

  if (type === "load") {
    try {
      await getTranscriber(modelId);
      self.postMessage({ type: "ready" });
    } catch (err: any) {
      self.postMessage({ type: "error", message: err?.message ?? "Failed to load the voice model" });
    }
    return;
  }

  if (type === "transcribe") {
    // requestId/interim are just echoed back — the worker doesn't need
    // to reason about ordering itself, only the caller does (dropping a
    // stale interim result that resolved after a newer one already did).
    const { audio, requestId, interim } = event.data as {
      audio: Float32Array;
      requestId: number;
      interim: boolean;
    };
    try {
      const transcriber = await getTranscriber(modelId);
      const output: any = await transcriber(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      const text = Array.isArray(output) ? output.map((o) => o.text).join(" ") : output.text;
      self.postMessage({ type: "result", text: (text ?? "").trim(), requestId, interim });
    } catch (err: any) {
      self.postMessage({
        type: "error",
        message: err?.message ?? "Transcription failed",
        requestId,
        interim,
      });
    }
  }
};
