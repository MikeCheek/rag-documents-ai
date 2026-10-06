"use client";

import { useEffect, useId, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { prepareMermaid, repairMermaid } from "@/lib/rich/mermaid-repair";

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
  const [expanded, setExpanded] = useState(false);

  // Escape closes the full-screen view.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  useEffect(() => {
    // While streaming the source is incomplete; render once it's final.
    if (streaming) return;
    let cancelled = false;
    loadMermaid()
      .then(async (mermaid) => {
        // Styling removed (it clashes with the dark theme); if the model's
        // syntax doesn't parse, try once more with the usual mistakes
        // repaired (unquoted labels with parentheses, reserved ids).
        const prepared = prepareMermaid(source);
        try {
          await mermaid.parse(prepared);
          return mermaid.render(id, prepared);
        } catch (firstError) {
          const repaired = repairMermaid(prepared);
          if (repaired === prepared) throw firstError;
          document.getElementById("d" + id)?.remove();
          return mermaid.render(id, repaired);
        }
      })
      .then(({ svg }: { svg: string }) => {
        if (!cancelled) {
          setSvg(naturalSize(svg));
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
    <>
      <figure className="mermaid-diagram relative my-3 rounded-lg border border-ink-600 bg-ink-850">
        <button
          onClick={() => setExpanded(true)}
          className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded border border-ink-600 bg-ink-900/90 px-1.5 py-0.5 text-[11px] text-paper-400 hover:text-paper-200 transition-colors"
          aria-label="Expand diagram"
        >
          <Maximize2 size={11} /> Expand
        </button>
        {/* Natural size, scrolling sideways when wider than the chat column:
            shrinking a wide diagram to fit makes its text unreadable. */}
        <div className="overflow-x-auto p-3">
          <div
            className="w-max mx-auto"
            // Sanitized by mermaid (securityLevel: "strict").
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </figure>
      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-ink-950/90 backdrop-blur-sm flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="Diagram"
          onClick={() => setExpanded(false)}
        >
          <div className="flex justify-end p-3">
            <button
              onClick={() => setExpanded(false)}
              className="flex items-center gap-1 rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-paper-300 hover:text-paper-100"
              aria-label="Close diagram"
            >
              <X size={13} /> Close
            </button>
          </div>
          <div className="flex-1 overflow-auto px-6 pb-6" onClick={(e) => e.stopPropagation()}>
            <div className="mermaid-diagram w-max mx-auto rounded-lg border border-ink-600 bg-ink-850 p-6" dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Mermaid emits width="100%" plus a max-width style, which shrinks wide
 * diagrams to the container. Give the SVG its natural pixel width instead.
 */
function naturalSize(svg: string): string {
  const max = /max-width:\s*([\d.]+)px/.exec(svg)?.[1];
  return max ? svg.replace(/width="100%"/, `width="${Math.ceil(Number(max))}"`) : svg;
}
