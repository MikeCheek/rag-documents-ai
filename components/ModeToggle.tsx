"use client";

import { BookOpen, Bot } from "lucide-react";
import { useMode } from "./ModeProvider";
import { cn } from "@/lib/utils";

export function ModeToggle() {
  const { mode, setMode } = useMode();

  return (
    <div
      className="flex items-center rounded-lg border border-ink-600 bg-ink-800 p-0.5"
      title="RAG mode retrieves then answers. Agent mode can call tools first."
    >
      {(
        [
          { value: "rag" as const, label: "RAG", icon: BookOpen },
          { value: "agent" as const, label: "Agent", icon: Bot },
        ]
      ).map((opt) => {
        const Icon = opt.icon;
        const active = mode === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => setMode(opt.value)}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors",
              active ? "bg-brass-400 text-ink-950" : "text-paper-400 hover:text-paper-200"
            )}
          >
            <Icon size={12} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
