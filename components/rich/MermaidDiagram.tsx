"use client";

import { useEffect, useId, useState } from "react";

// Renders a ```mermaid block (flowcharts, sequence diagrams, timelines,
// ...). mermaid is large, so it's only loaded the first time an answer
// contains a diagram. securityLevel "strict" sanitizes the output and
// disables click handlers and HTML labels: the diagram source comes from
// the model, which can be steered by document or tool content.

let mermaidPromise: Promise<any> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: "inherit",
        themeVariables: {
          darkMode: true,
          background: "#141926",
          primaryColor: "#1F2531",
          primaryBorderColor: "#3A4356",
          primaryTextColor: "#E8E5DD",
          secondaryColor: "#171C27",
          tertiaryColor: "#10141C",
          lineColor: "#8E8A80",
          textColor: "#E8E5DD",
          noteBkgColor: "#2A3140",
          noteTextColor: "#E8E5DD",
          noteBorderColor: "#3A4356",
          edgeLabelBackground: "#141926",
          fontSize: "13px",
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

export function MermaidDiagram({ source, streaming }: { source: string; streaming?: boolean }) {
  const id = "mmd-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // While streaming the source is incomplete; render once it's final.
    if (streaming) return;
    let cancelled = false;
    loadMermaid()
      .then((mermaid) => mermaid.render(id, source.trim()))
      .then(({ svg }: { svg: string }) => {
        if (!cancelled) {
          setSvg(svg);
          setError(null);
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message?.split("\n")[0] ?? "Invalid diagram");
        // mermaid leaves an error element behind on failure.
        document.getElementById("d" + id)?.remove();
      });
    return () => {
      cancelled = true;
    };
  }, [id, source, streaming]);

  if (error) {
    return (
      <div className="my-3 rounded-lg border border-ink-600 bg-ink-850 p-3">
        <p className="text-[11px] text-rust-400 mb-1">Couldn&apos;t draw this diagram: {error}</p>
        <pre className="text-[11px] font-mono text-paper-400 whitespace-pre-wrap">{source}</pre>
      </div>
    );
  }
  if (!svg) {
    return <div className="my-3 h-32 rounded-lg border border-ink-600 bg-ink-850 animate-pulse" aria-label="Drawing diagram" />;
  }
  return (
    <figure
      className="mermaid-diagram my-3 rounded-lg border border-ink-600 bg-ink-850 p-3 overflow-x-auto flex justify-center"
      // Sanitized by mermaid (securityLevel: "strict").
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
