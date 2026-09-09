"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { ChevronDown, ChevronRight, Wrench, CheckCircle2, XCircle, MessageCircle } from "lucide-react";
import type { AgentStep } from "@/types";
import { normalizeMathDelimiters } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import "katex/dist/katex.min.css";

function StepRow({ step }: { step: AgentStep }) {
  if (step.type === "message") {
    return (
      <div className="flex items-start gap-2 py-1">
        <MessageCircle size={13} className="text-paper-400 mt-0.5 shrink-0" />
        <div className="text-xs text-paper-300 leading-relaxed prose-answer">
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {normalizeMathDelimiters(step.content)}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  if (step.type === "tool_call") {
    const argsPreview = Object.entries(step.arguments)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(", ");
    return (
      <div className="flex items-start gap-2 py-1">
        <Wrench size={13} className="text-brass-300 mt-0.5 shrink-0" />
        <p className="text-xs text-paper-300 leading-relaxed">
          <span className="font-mono text-brass-300">{step.name}</span>
          {argsPreview && <span className="text-paper-400">({argsPreview})</span>}
        </p>
      </div>
    );
  }

  // tool_result
  const Icon = step.success ? CheckCircle2 : XCircle;
  return (
    <div className="flex items-start gap-2 py-1">
      <Icon size={13} className={cn("mt-0.5 shrink-0", step.success ? "text-teal-400" : "text-rust-400")} />
      <p className="text-xs text-paper-400 leading-relaxed line-clamp-3">
        {step.result.slice(0, 300)}
        {step.result.length > 300 ? "…" : ""}
        <span className="text-paper-400/70"> ({step.durationMs}ms)</span>
      </p>
    </div>
  );
}

export function AgentSteps({ steps, live }: { steps: AgentStep[]; live?: boolean }) {
  const [expanded, setExpanded] = useState(!!live);

  if (steps.length === 0) return null;

  const toolCallCount = steps.filter((s) => s.type === "tool_call").length;

  return (
    <div className="mb-3 rounded-lg border border-ink-600 bg-ink-800/60 overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-paper-400 hover:text-paper-200 transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {live ? "Thinking..." : `Thinking (${toolCallCount} tool call${toolCallCount === 1 ? "" : "s"})`}
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 pt-0.5 border-t border-ink-700/60">
          {steps.map((step, i) => (
            <StepRow key={i} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}
