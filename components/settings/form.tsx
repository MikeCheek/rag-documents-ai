"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Small shared form primitives for the Integrations settings, matching the
// existing Settings styling.

const control =
  "bg-ink-800 border border-ink-600 rounded px-2 py-1.5 text-sm text-paper-200 outline-none focus:border-brass-400/60 placeholder:text-paper-400/60";

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1 text-xs text-paper-400", className)}>
      {label}
      {children}
      {hint && <span className="text-[11px] text-paper-400/80 leading-relaxed">{hint}</span>}
    </label>
  );
}

export function TextInput({ className, mono, ...props }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return <input {...props} className={cn(control, mono && "font-mono", className)} />;
}

export function TextArea({ className, mono, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }) {
  return <textarea {...props} className={cn(control, "resize-y", mono && "font-mono text-xs", className)} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(control, className)} />;
}

export function PrimaryButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "text-xs bg-brass-400 text-ink-950 rounded px-3 py-1.5 hover:bg-brass-300 disabled:opacity-40 transition-colors",
        className
      )}
    />
  );
}

export function GhostButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn("text-xs text-paper-400 hover:text-paper-200 px-2 py-1.5 disabled:opacity-40 transition-colors", className)}
    />
  );
}

export function LinkButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "flex items-center gap-1 text-xs text-brass-300 hover:text-brass-200 disabled:opacity-40 transition-colors",
        className
      )}
    />
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "warn" }) {
  return (
    <span
      className={cn(
        "text-[10px] rounded-full px-1.5 py-0.5 border shrink-0",
        tone === "ok" && "border-teal-500/40 text-teal-400 bg-teal-500/10",
        tone === "warn" && "border-brass-400/40 text-brass-300 bg-brass-400/10",
        tone === "muted" && "border-ink-600 text-paper-400"
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className, dim }: { children: ReactNode; className?: string; dim?: boolean }) {
  return (
    <div className={cn("rounded-lg border px-3 py-2.5", dim ? "border-ink-700 bg-ink-800/50" : "border-ink-600 bg-ink-800", className)}>
      {children}
    </div>
  );
}

export function Panel({ title, onClose, children }: { title: string; onClose?: () => void; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-brass-400/40 bg-ink-850 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-paper-200 font-medium">{title}</p>
        {onClose && (
          <button onClick={onClose} className="text-paper-400 hover:text-paper-200 p-1" aria-label="Close">
            ×
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p className="text-xs text-rust-400">{children}</p> : null;
}

/** Key/value rows. Values can be write-only: shown empty, with `valuePlaceholder` (e.g. "unchanged"). */
export function KeyValueRows({
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  secret,
}: {
  rows: { key: string; value: string }[];
  onChange: (rows: { key: string; value: string }[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  secret?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <TextInput
            mono
            value={row.key}
            placeholder={keyPlaceholder}
            onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
            className="flex-1 text-xs py-1"
          />
          <TextInput
            mono
            type={secret ? "password" : "text"}
            value={row.value}
            placeholder={valuePlaceholder}
            onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
            className="flex-[1.5] text-xs py-1"
          />
          <button
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="text-paper-400 hover:text-rust-400 px-1 text-sm"
            aria-label="Remove row"
          >
            ×
          </button>
        </div>
      ))}
      <LinkButton type="button" onClick={() => onChange([...rows, { key: "", value: "" }])} className="self-start">
        + Add
      </LinkButton>
    </div>
  );
}

export function rowsToRecord(rows: { key: string; value: string }[]): Record<string, string> {
  return Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));
}

export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { "Content-Type": "application/json" } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json as T;
}
