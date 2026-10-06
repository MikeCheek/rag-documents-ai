"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

/** A fenced code block: language label, copy button, highlighted body (rehype-highlight). */
export function CodeBlock({ language, raw, children }: { language?: string; raw: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block my-3 rounded-lg border border-ink-600 bg-ink-950 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 border-b border-ink-700 text-[10px] text-paper-400">
        <span className="font-mono uppercase tracking-wide">{language || "text"}</span>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(raw).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="flex items-center gap-1 hover:text-paper-200 transition-colors"
          aria-label="Copy code"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 text-[12.5px] leading-relaxed">{children}</pre>
    </div>
  );
}
