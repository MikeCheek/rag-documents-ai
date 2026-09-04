"use client";

import { useCallback, useState } from "react";
import { UploadCloud } from "lucide-react";
import type { DocumentRecord } from "@/types";
import { PipelineStatus } from "./PipelineStatus";
import { cn } from "@/lib/utils";

type InFlightStage = { stage: string; detail?: string } | null;

export function UploadZone({
  onDocumentUpdate,
}: {
  onDocumentUpdate: (doc: DocumentRecord) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage] = useState<InFlightStage>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      setError(null);
      setStage({ stage: "reading" });

      const formData = new FormData();
      list.forEach((f) => formData.append("files", f));

      try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        if (!res.body) throw new Error("No response stream from server.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === "stage") {
              setStage({ stage: event.stage, detail: event.detail });
            } else if (event.type === "document") {
              onDocumentUpdate(event.document);
            } else if (event.type === "error") {
              setError(event.message);
            }
          }
        }
      } catch (err: any) {
        setError(err?.message ?? "Upload failed.");
      } finally {
        setStage(null);
      }
    },
    [onDocumentUpdate]
  );

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files) upload(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center cursor-pointer transition-colors",
          isDragging
            ? "border-brass-400 bg-brass-400/5"
            : "border-ink-600 hover:border-ink-500 bg-ink-800/50"
        )}
      >
        <UploadCloud size={20} className="text-paper-400" />
        <p className="text-sm text-paper-300">
          <span className="text-brass-300">Choose files</span> or drop them here
        </p>
        <p className="text-xs text-paper-400">PDF, DOCX, TXT, MD, CSV</p>
        <input
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.markdown,.csv"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) upload(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {stage && (
        <div className="mt-3 px-1">
          <PipelineStatus stage={stage.stage} detail={stage.detail} kind="upload" />
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rust-400 px-1">{error}</p>}
    </div>
  );
}
