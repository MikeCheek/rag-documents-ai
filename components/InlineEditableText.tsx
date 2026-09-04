"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function InlineEditableText({
  value,
  onSave,
  className,
  inputClassName,
}: {
  value: string;
  onSave: (next: string) => void | Promise<void>;
  className?: string;
  inputClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(value);
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        className={cn(
          "bg-ink-700 border border-brass-400/50 rounded px-1.5 py-0.5 outline-none w-full",
          inputClassName
        )}
      />
    );
  }

  return (
    <span
      onDoubleClick={startEdit}
      title="Double-click to rename"
      className={cn("cursor-text", className)}
    >
      {value}
    </span>
  );
}
