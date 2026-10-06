"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_WHISPER_MODEL } from "@/lib/voice/whisper-models";

type Status = "idle" | "recording" | "transcribing" | "error";
type PendingKind = null | "interim" | "final";

const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

// How often the growing recording gets re-transcribed while still
// recording, so the prompt fills in as you talk rather than only once
// you stop. Whisper isn't a streaming model — each pass re-transcribes
// everything captured so far, not just what's new — so this is "updates
// every couple of seconds", not literal word-by-word live captioning;
// short enough to feel responsive, long enough that re-transcribing a
// growing buffer stays cheap for a normal prompt-length recording.
const INTERIM_INTERVAL_MS = 2500;

function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return CANDIDATE_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Fully local speech-to-text: records from the mic, transcribes with
 * Whisper running in a Web Worker via @xenova/transformers' WASM backend
 * — no audio ever leaves the browser. Updates `value` progressively as
 * the recording grows, not just once at the end; whatever text was
 * already in the input when recording started is preserved and kept in
 * front of the dictated text.
 */
export function VoiceInputButton({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string | undefined>(undefined);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const valueRef = useRef(value);
  valueRef.current = value;
  const baseTextRef = useRef("");
  const whisperModelRef = useRef(DEFAULT_WHISPER_MODEL);

  const isTranscribingRef = useRef(false);
  const pendingRef = useRef<PendingKind>(null);
  const requestCounterRef = useRef(0);
  const latestProcessedRequestIdRef = useRef(0);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((json) => {
        if (json?.limits?.whisperModel) whisperModelRef.current = json.limits.whisperModel;
      })
      .catch(() => {});
  }, []);

  function getWorker(): Worker {
    if (!workerRef.current) {
      const worker = new Worker(new URL("../lib/voice/asr-worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event: MessageEvent) => {
        const { type } = event.data ?? {};

        if (type === "progress") {
          const d = event.data.data;
          if (d?.status === "progress" && d.file) {
            const pct = d.progress ? Math.round(d.progress) : 0;
            setProgressLabel(`Loading voice model — ${d.file} (${pct}%)`);
          } else if (d?.status === "done") {
            setProgressLabel(null);
          }
          return;
        }

        if (type === "result" || type === "error") {
          const { requestId, interim } = event.data;
          isTranscribingRef.current = false;

          if (type === "result") {
            if (requestId >= latestProcessedRequestIdRef.current) {
              latestProcessedRequestIdRef.current = requestId;
              const spoken: string = event.data.text ?? "";
              if (spoken) {
                const combined = baseTextRef.current
                  ? `${baseTextRef.current} ${spoken}`.trim()
                  : spoken;
                onChangeRef.current(combined);
              }
            }
          } else if (!interim) {
            // Only surface an error for the *final* pass — a single
            // failed interim pass just means that update is skipped,
            // recording carries on, and the next interval tries again.
            setStatus("error");
            setErrorMessage(event.data.message ?? "Transcription failed");
          }

          if (interim === false) {
            setStatus((s) => (s === "error" ? s : "idle"));
            setProgressLabel(null);
            pendingRef.current = null;
            return;
          }

          const next = pendingRef.current;
          pendingRef.current = null;
          if (next) runTranscription(next);
        }
      };
      workerRef.current = worker;
    }
    return workerRef.current;
  }

  // Always call the latest onChange even though the worker callback above
  // is only wired up once (the worker/its onmessage handler persist
  // across renders) — avoids a stale closure over an old onChange prop.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      workerRef.current?.terminate();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function runTranscription(kind: "interim" | "final") {
    if (isTranscribingRef.current) {
      // A final pass always supersedes a queued interim one — no point
      // running an interim update immediately before the final result.
      if (kind === "final" || pendingRef.current === null) {
        pendingRef.current = kind;
      }
      return;
    }

    const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || "audio/webm" });
    if (blob.size === 0) {
      if (kind === "final") setStatus("idle");
      return;
    }

    isTranscribingRef.current = true;
    try {
      const { blobToWhisperInput } = await import("@/lib/voice/audio-utils");
      const audio = await blobToWhisperInput(blob);
      const requestId = ++requestCounterRef.current;
      getWorker().postMessage(
        {
          type: "transcribe",
          audio,
          requestId,
          interim: kind === "interim",
          modelId: whisperModelRef.current,
        },
        [audio.buffer]
      );
    } catch (err: any) {
      isTranscribingRef.current = false;
      if (kind === "final") {
        setStatus("error");
        setErrorMessage(err?.message ?? "Couldn't process the recording");
      }
    }
  }

  async function startRecording() {
    setErrorMessage(null);
    baseTextRef.current = valueRef.current.trim();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickSupportedMimeType();
      mimeTypeRef.current = mimeType;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          // Triggered from here, not from the interval below, so this is
          // guaranteed to run after the new chunk has actually landed in
          // chunksRef — requestData() delivers its data asynchronously,
          // so calling runTranscription() right after requestData()
          // itself could still be reading last interval's buffer.
          runTranscription("interim");
        }
      };

      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setStatus("transcribing");
        runTranscription("final");
      };

      mediaRecorderRef.current = recorder;
      recorder.start(); // one blob per requestData() call below, not one per timeslice
      setStatus("recording");

      setProgressLabel("Loading voice model...");
      getWorker().postMessage({ type: "load", modelId: whisperModelRef.current });

      // Periodically flushes the recorder's current buffer — the actual
      // re-transcription of everything captured so far is triggered from
      // ondataavailable above, once the flushed data has actually landed.
      intervalRef.current = setInterval(() => {
        mediaRecorderRef.current?.requestData();
      }, INTERIM_INTERVAL_MS);
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(
        err?.name === "NotAllowedError"
          ? "Microphone access was denied."
          : err?.message ?? "Couldn't access the microphone."
      );
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  function handleClick() {
    if (status === "recording") {
      stopRecording();
    } else if (status === "idle" || status === "error") {
      startRecording();
    }
  }

  const isBusy = status === "transcribing";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isBusy}
        title={
          status === "recording"
            ? "Stop recording"
            : errorMessage ?? "Dictate your prompt (processed locally, offline)"
        }
        className={cn(
          "flex items-center justify-center h-8 w-8 rounded-lg transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed",
          status === "recording"
            ? "bg-rust-500 text-ink-950 hover:bg-rust-400 animate-pulse"
            : "border border-ink-600 text-paper-400 hover:text-paper-200 hover:border-brass-400/50"
        )}
        aria-label={status === "recording" ? "Stop recording" : "Voice input"}
      >
        {status === "recording" ? (
          <Square size={12} fill="currentColor" />
        ) : isBusy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Mic size={15} />
        )}
      </button>
      {(progressLabel || errorMessage) && (
        <div
          className={cn(
            "absolute bottom-full right-0 mb-2 w-56 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug whitespace-normal",
            errorMessage
              ? "border-rust-500/40 bg-rust-500/10 text-rust-400"
              : "border-ink-600 bg-ink-800 text-paper-400"
          )}
        >
          {errorMessage ?? progressLabel}
        </div>
      )}
    </div>
  );
}
