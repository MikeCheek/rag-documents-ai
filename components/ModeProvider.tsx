"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ChatMode } from "@/types";

const STORAGE_KEY = "reading-room:mode";

const ModeContext = createContext<{
  mode: ChatMode;
  setMode: (mode: ChatMode) => void;
} | null>(null);

export function ModeProvider({ children }: { children: React.ReactNode }) {
  // Starts as "rag" for a stable server-render, then syncs from
  // localStorage once mounted — avoids a hydration mismatch from reading
  // localStorage during the initial render.
  const [mode, setModeState] = useState<ChatMode>("rag");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "agent" || stored === "rag") setModeState(stored);
  }, []);

  function setMode(next: ChatMode) {
    setModeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}

export function useMode() {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode must be used within a ModeProvider");
  return ctx;
}
