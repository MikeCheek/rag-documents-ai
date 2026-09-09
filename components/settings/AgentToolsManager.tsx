"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, X, Wrench } from "lucide-react";
import type { AgentToolRecord, BuiltinToolInfo, ToolParameter } from "@/types";
import { cn } from "@/lib/utils";

const PARAM_TYPES: ToolParameter["type"][] = ["string", "number", "boolean"];

function emptyParam(): ToolParameter {
  return { name: "", type: "string", description: "", required: false };
}

function NewToolForm({
  onCreated,
  onCancel,
}: {
  onCreated: (tool: AgentToolRecord) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState<"GET" | "POST">("GET");
  const [urlTemplate, setUrlTemplate] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [parameters, setParameters] = useState<ToolParameter[]>([emptyParam()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError(null);

    let headers: Record<string, string> | null = null;
    if (headersText.trim()) {
      try {
        headers = JSON.parse(headersText);
      } catch {
        setError("Custom headers must be valid JSON, e.g. {\"Authorization\": \"Bearer ...\"}");
        return;
      }
    }

    const cleanParams = parameters.filter((p) => p.name.trim());

    setSaving(true);
    try {
      const res = await fetch("/api/agent-tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          method,
          urlTemplate: urlTemplate.trim(),
          parameters: cleanParams,
          headers,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create tool");
      onCreated(json.tool);
    } catch (err: any) {
      setError(err?.message ?? "Failed to create tool");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-brass-400/40 bg-ink-850 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-paper-200 font-medium">New tool</p>
        <button onClick={onCancel} className="text-paper-400 hover:text-paper-200 p-1">
          <X size={14} />
        </button>
      </div>

      {error && <p className="text-xs text-rust-400">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-paper-400">
          Name (function id)
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="get_weather"
            className="bg-ink-800 border border-ink-600 rounded px-2 py-1.5 text-sm text-paper-200 outline-none focus:border-brass-400/60"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-paper-400">
          Method
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as "GET" | "POST")}
            className="bg-ink-800 border border-ink-600 rounded px-2 py-1.5 text-sm text-paper-200 outline-none focus:border-brass-400/60"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-paper-400">
        Description (tells the model when to use this tool)
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Get the current weather for a city."
          className="bg-ink-800 border border-ink-600 rounded px-2 py-1.5 text-sm text-paper-200 outline-none focus:border-brass-400/60 resize-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-paper-400">
        URL template ({"{param}"} placeholders get substituted)
        <input
          value={urlTemplate}
          onChange={(e) => setUrlTemplate(e.target.value)}
          placeholder="https://api.example.com/weather?city={city}"
          className="bg-ink-800 border border-ink-600 rounded px-2 py-1.5 text-sm text-paper-200 outline-none focus:border-brass-400/60 font-mono"
        />
      </label>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-paper-400">Parameters</p>
        {parameters.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={p.name}
              onChange={(e) =>
                setParameters((prev) =>
                  prev.map((row, j) => (j === i ? { ...row, name: e.target.value } : row))
                )
              }
              placeholder="city"
              className="flex-1 bg-ink-800 border border-ink-600 rounded px-2 py-1 text-xs text-paper-200 outline-none focus:border-brass-400/60 font-mono"
            />
            <select
              value={p.type}
              onChange={(e) =>
                setParameters((prev) =>
                  prev.map((row, j) =>
                    j === i ? { ...row, type: e.target.value as ToolParameter["type"] } : row
                  )
                )
              }
              className="bg-ink-800 border border-ink-600 rounded px-1.5 py-1 text-xs text-paper-200 outline-none"
            >
              {PARAM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              value={p.description}
              onChange={(e) =>
                setParameters((prev) =>
                  prev.map((row, j) => (j === i ? { ...row, description: e.target.value } : row))
                )
              }
              placeholder="description"
              className="flex-[1.5] bg-ink-800 border border-ink-600 rounded px-2 py-1 text-xs text-paper-200 outline-none focus:border-brass-400/60"
            />
            <label className="flex items-center gap-1 text-[11px] text-paper-400 shrink-0">
              <input
                type="checkbox"
                checked={p.required}
                onChange={(e) =>
                  setParameters((prev) =>
                    prev.map((row, j) =>
                      j === i ? { ...row, required: e.target.checked } : row
                    )
                  )
                }
              />
              required
            </label>
            <button
              onClick={() => setParameters((prev) => prev.filter((_, j) => j !== i))}
              className="text-paper-400 hover:text-rust-400 p-0.5 shrink-0"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button
          onClick={() => setParameters((prev) => [...prev, emptyParam()])}
          className="text-xs text-brass-300 hover:text-brass-200 self-start transition-colors"
        >
          + Add parameter
        </button>
      </div>

      <label className="flex flex-col gap-1 text-xs text-paper-400">
        Custom headers (JSON, optional — e.g. an API key)
        <textarea
          value={headersText}
          onChange={(e) => setHeadersText(e.target.value)}
          rows={2}
          placeholder='{"Authorization": "Bearer ..."}'
          className="bg-ink-800 border border-ink-600 rounded px-2 py-1.5 text-xs text-paper-200 outline-none focus:border-brass-400/60 font-mono resize-none"
        />
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="text-xs text-paper-400 hover:text-paper-200 px-2 py-1.5"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving || !name.trim() || !description.trim() || !urlTemplate.trim()}
          className="text-xs bg-brass-400 text-ink-950 rounded px-3 py-1.5 hover:bg-brass-300 disabled:opacity-40 transition-colors"
        >
          {saving ? "Creating..." : "Create tool"}
        </button>
      </div>
    </div>
  );
}

export function AgentToolsManager() {
  const [builtin, setBuiltin] = useState<BuiltinToolInfo[]>([]);
  const [custom, setCustom] = useState<AgentToolRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/agent-tools");
      const json = await res.json();
      setBuiltin(json.builtin ?? []);
      setCustom(json.custom ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load tools");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleEnabled(tool: AgentToolRecord) {
    setCustom((prev) =>
      prev.map((t) => (t.id === tool.id ? { ...t, enabled: !t.enabled } : t))
    );
    await fetch(`/api/agent-tools/${tool.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !tool.enabled }),
    }).catch(() => {});
  }

  async function deleteTool(id: string) {
    if (!confirm("Delete this tool? Chats that used it keep their history either way.")) return;
    setCustom((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/agent-tools/${id}`, { method: "DELETE" }).catch(() => {});
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-rust-400">{error}</p>}

      {!loading && (
        <>
          <div>
            <p className="text-xs text-paper-400 mb-2">Built in</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {builtin.map((t) => (
                <div
                  key={t.name}
                  className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Wrench size={12} className="text-paper-400 shrink-0" />
                      <span className="text-xs font-mono text-paper-200 truncate">{t.name}</span>
                    </div>
                    {!t.configured && (
                      <span className="text-[10px] text-brass-300 border border-brass-400/40 bg-brass-400/10 rounded-full px-1.5 py-0.5 shrink-0">
                        needs setup
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-paper-400 leading-relaxed">{t.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-paper-400">Custom tools</p>
              {!showForm && (
                <button
                  onClick={() => setShowForm(true)}
                  className="flex items-center gap-1 text-xs text-brass-300 hover:text-brass-200 transition-colors"
                >
                  <Plus size={13} />
                  Add tool
                </button>
              )}
            </div>

            {showForm && (
              <div className="mb-3">
                <NewToolForm
                  onCreated={(tool) => {
                    setCustom((prev) => [...prev, tool]);
                    setShowForm(false);
                  }}
                  onCancel={() => setShowForm(false)}
                />
              </div>
            )}

            {custom.length === 0 && !showForm && (
              <p className="text-xs text-paper-400">
                No custom tools yet — add one to give the agent access to an external API.
              </p>
            )}

            <div className="flex flex-col gap-2">
              {custom.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 flex items-start justify-between gap-3",
                    t.enabled ? "border-ink-600 bg-ink-800" : "border-ink-700 bg-ink-800/50"
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Wrench size={12} className={t.enabled ? "text-brass-300" : "text-paper-400"} />
                      <span className="text-xs font-mono text-paper-200">{t.name}</span>
                      <span className="text-[10px] font-mono text-paper-400 uppercase">
                        {t.method}
                      </span>
                    </div>
                    <p className="text-[11px] text-paper-400 leading-relaxed">{t.description}</p>
                    <p className="text-[10px] font-mono text-paper-400/70 mt-1 truncate">
                      {t.urlTemplate}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => toggleEnabled(t)}
                      className={cn(
                        "text-[11px] px-2 py-1 rounded-full border transition-colors",
                        t.enabled
                          ? "border-teal-500/40 text-teal-400"
                          : "border-ink-600 text-paper-400"
                      )}
                    >
                      {t.enabled ? "Enabled" : "Disabled"}
                    </button>
                    <button
                      onClick={() => deleteTool(t.id)}
                      className="text-paper-400 hover:text-rust-400 p-1"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
