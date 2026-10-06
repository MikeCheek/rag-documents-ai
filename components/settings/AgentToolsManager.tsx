"use client";

import { useEffect, useState } from "react";
import { FlaskConical, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import type {
  AgentToolRecord,
  ApiConnectionRecord,
  BuiltinToolInfo,
  HttpMethod,
  ToolParameter,
  ToolParameterType,
} from "@/types";
import { cn } from "@/lib/utils";
import {
  api,
  Badge,
  Card,
  ErrorText,
  Field,
  GhostButton,
  KeyValueRows,
  LinkButton,
  Panel,
  PrimaryButton,
  rowsToRecord,
  Select,
  TextArea,
  TextInput,
} from "./form";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const PARAM_TYPES: ToolParameterType[] = ["string", "number", "integer", "boolean", "array", "object"];

function emptyParam(): ToolParameter {
  return { name: "", type: "string", description: "", required: false };
}

function ToolForm({
  editing,
  connections,
  onDone,
  onCancel,
}: {
  editing?: AgentToolRecord;
  connections: ApiConnectionRecord[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [method, setMethod] = useState<HttpMethod>(editing?.method ?? "GET");
  const [connectionId, setConnectionId] = useState(editing?.connectionId ?? "");
  const [urlTemplate, setUrlTemplate] = useState(editing?.urlTemplate ?? "");
  const [headers, setHeaders] = useState(
    Object.entries(editing?.headers ?? {}).map(([key, value]) => ({ key, value }))
  );
  const [parameters, setParameters] = useState<ToolParameter[]>(editing?.parameters.length ? editing.parameters : [emptyParam()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const connection = connections.find((c) => c.id === connectionId);
  const updateParam = (i: number, patch: Partial<ToolParameter>) =>
    setParameters((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  async function save() {
    setError(null);
    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim(),
      method,
      urlTemplate: urlTemplate.trim(),
      connectionId: connectionId || null,
      parameters: parameters.filter((p) => p.name.trim()),
      headers: rowsToRecord(headers),
    };
    try {
      if (editing) {
        const { name: _n, ...patch } = payload;
        await api(`/api/agent-tools/${editing.id}`, { method: "PATCH", json: patch });
      } else {
        await api("/api/agent-tools", { method: "POST", json: payload });
      }
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const sendsBody = method === "POST" || method === "PUT" || method === "PATCH";

  return (
    <Panel title={editing ? `Edit ${editing.name}` : "New tool"} onClose={onCancel}>
      <ErrorText>{error}</ErrorText>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Name (function id)" className="sm:col-span-2">
          <TextInput mono value={name} disabled={!!editing} onChange={(e) => setName(e.target.value)} placeholder="get_weather" />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Description (tells the model when to use this tool)">
        <TextArea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Get the current weather for a city." />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="API connection" hint={connection ? `Auth and base URL from "${connection.name}".` : "Optional: base URL + auth."}>
          <Select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
            <option value="">None (absolute URL)</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={connection ? "Path" : "URL"}
          className="sm:col-span-2"
          hint={
            <>
              {"{param}"} placeholders are filled in. Other parameters go in the{" "}
              {sendsBody ? "JSON body" : "query string"}.
            </>
          }
        >
          <TextInput
            mono
            value={urlTemplate}
            onChange={(e) => setUrlTemplate(e.target.value)}
            placeholder={connection ? "/weather/{city}" : "https://api.example.com/weather?city={city}"}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-paper-400">Parameters</p>
        {parameters.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <TextInput mono value={p.name} onChange={(e) => updateParam(i, { name: e.target.value })} placeholder="city" className="flex-1 min-w-[90px] text-xs py-1" />
            <Select value={p.type} onChange={(e) => updateParam(i, { type: e.target.value as ToolParameterType })} className="text-xs py-1">
              {PARAM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <TextInput value={p.description} onChange={(e) => updateParam(i, { description: e.target.value })} placeholder="description" className="flex-[2] min-w-[140px] text-xs py-1" />
            <label className="flex items-center gap-1 text-[11px] text-paper-400 shrink-0">
              <input type="checkbox" checked={p.required} onChange={(e) => updateParam(i, { required: e.target.checked })} />
              required
            </label>
            <button onClick={() => setParameters((prev) => prev.filter((_, j) => j !== i))} className="text-paper-400 hover:text-rust-400 p-0.5" aria-label="Remove parameter">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <LinkButton onClick={() => setParameters((prev) => [...prev, emptyParam()])} className="self-start">
          + Add parameter
        </LinkButton>
      </div>

      <Field label="Extra headers (optional)" hint={connection ? "Prefer the connection for credentials." : undefined}>
        <KeyValueRows rows={headers} onChange={setHeaders} keyPlaceholder="Accept" valuePlaceholder="value" />
      </Field>

      <div className="flex justify-end gap-2 pt-1">
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
        <PrimaryButton onClick={save} disabled={saving || !name.trim() || !description.trim() || !urlTemplate.trim()}>
          {saving ? "Saving..." : editing ? "Save" : "Create tool"}
        </PrimaryButton>
      </div>
    </Panel>
  );
}

function sampleArgs(tool: AgentToolRecord): string {
  const sample: Record<string, unknown> = {};
  for (const p of tool.parameters) {
    if (!p.required) continue;
    sample[p.name] =
      p.enum?.[0] ??
      (p.type === "number" || p.type === "integer" ? 1 : p.type === "boolean" ? true : p.type === "array" ? [] : p.type === "object" ? {} : "");
  }
  return JSON.stringify(sample, null, 2);
}

/** Runs a tool once with hand-written arguments, exactly as the agent would. */
function ToolTester({ tool, onClose }: { tool: AgentToolRecord; onClose: () => void }) {
  const [args, setArgs] = useState(sampleArgs(tool));
  const [result, setResult] = useState<{ success: boolean; result: unknown; durationMs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setError(null);
    setResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(args || "{}");
    } catch {
      setError("Arguments must be valid JSON.");
      return;
    }
    setRunning(true);
    try {
      setResult(await api(`/api/agent-tools/${tool.id}/test`, { method: "POST", json: { args: parsed } }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-ink-700 pt-2">
      <Field label="Arguments (JSON)">
        <TextArea mono rows={Math.min(8, args.split("\n").length + 1)} value={args} onChange={(e) => setArgs(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <PrimaryButton onClick={run} disabled={running}>
          {running ? "Running..." : "Run"}
        </PrimaryButton>
        <GhostButton onClick={onClose}>Close</GhostButton>
      </div>
      <ErrorText>{error}</ErrorText>
      {result && (
        <div>
          <p className={cn("text-[11px] mb-1", result.success ? "text-teal-400" : "text-rust-400")}>
            {result.success ? "Succeeded" : "Failed"} in {result.durationMs} ms
          </p>
          <pre className="text-[11px] font-mono text-paper-300 bg-ink-900 rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">
            {typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function AgentToolsManager({ refreshKey = 0 }: { refreshKey?: number }) {
  const [builtin, setBuiltin] = useState<BuiltinToolInfo[]>([]);
  const [custom, setCustom] = useState<AgentToolRecord[]>([]);
  const [connections, setConnections] = useState<ApiConnectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<null | "new" | { edit: AgentToolRecord }>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [tools, conns] = await Promise.all([
        api<{ builtin: BuiltinToolInfo[]; custom: AgentToolRecord[] }>("/api/agent-tools"),
        api<{ connections: ApiConnectionRecord[] }>("/api/api-connections"),
      ]);
      setBuiltin(tools.builtin ?? []);
      setCustom(tools.custom ?? []);
      setConnections(conns.connections ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [refreshKey]);

  async function toggleEnabled(tool: AgentToolRecord) {
    setCustom((prev) => prev.map((t) => (t.id === tool.id ? { ...t, enabled: !t.enabled } : t)));
    await api(`/api/agent-tools/${tool.id}`, { method: "PATCH", json: { enabled: !tool.enabled } }).catch(() => load());
  }

  async function deleteTool(id: string) {
    if (!confirm("Delete this tool? Chats that used it keep their history either way.")) return;
    setCustom((prev) => prev.filter((t) => t.id !== id));
    await api(`/api/agent-tools/${id}`, { method: "DELETE" }).catch(() => load());
  }

  const connectionName = (id: string | null) => connections.find((c) => c.id === id)?.name;

  return (
    <div className="flex flex-col gap-4">
      <ErrorText>{error}</ErrorText>

      {!loading && (
        <>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-paper-400">Custom tools</p>
              {!mode && (
                <LinkButton onClick={() => setMode("new")}>
                  <Plus size={13} /> Add tool
                </LinkButton>
              )}
            </div>

            {mode && (
              <div className="mb-3">
                <ToolForm
                  editing={typeof mode === "object" ? mode.edit : undefined}
                  connections={connections}
                  onDone={() => {
                    setMode(null);
                    load();
                  }}
                  onCancel={() => setMode(null)}
                />
              </div>
            )}

            {custom.length === 0 && !mode && (
              <p className="text-xs text-paper-400">
                No custom tools yet: add one, or import a whole API from its OpenAPI spec above.
              </p>
            )}

            <div className="flex flex-col gap-2">
              {custom.map((t) => (
                <Card key={t.id} dim={!t.enabled}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <Wrench size={12} className={t.enabled ? "text-brass-300" : "text-paper-400"} />
                        <span className="text-xs font-mono text-paper-200">{t.name}</span>
                        <span className="text-[10px] font-mono text-paper-400 uppercase">{t.method}</span>
                        {t.connectionId && <Badge>{connectionName(t.connectionId) ?? "connection"}</Badge>}
                      </div>
                      <p className="text-[11px] text-paper-400 leading-relaxed line-clamp-2">{t.description}</p>
                      <p className="text-[10px] font-mono text-paper-400/70 mt-1 truncate">{t.urlTemplate}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleEnabled(t)}
                        className={cn(
                          "text-[11px] px-2 py-1 rounded-full border transition-colors mr-1",
                          t.enabled ? "border-teal-500/40 text-teal-400" : "border-ink-600 text-paper-400"
                        )}
                      >
                        {t.enabled ? "Enabled" : "Disabled"}
                      </button>
                      <button onClick={() => setTesting(testing === t.id ? null : t.id)} className="text-paper-400 hover:text-brass-300 p-1" aria-label={`Test ${t.name}`} title="Test">
                        <FlaskConical size={13} />
                      </button>
                      <button onClick={() => setMode({ edit: t })} className="text-paper-400 hover:text-paper-200 p-1" aria-label={`Edit ${t.name}`} title="Edit">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => deleteTool(t.id)} className="text-paper-400 hover:text-rust-400 p-1" aria-label={`Delete ${t.name}`} title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  {testing === t.id && <ToolTester tool={t} onClose={() => setTesting(null)} />}
                </Card>
              ))}
            </div>
          </div>

          <details className="group">
            <summary className="text-xs text-paper-400 cursor-pointer select-none mb-2">
              Built-in tools ({builtin.length})
            </summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {builtin.map((t) => (
                <Card key={t.name}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Wrench size={12} className="text-paper-400 shrink-0" />
                      <span className="text-xs font-mono text-paper-200 truncate">{t.name}</span>
                    </div>
                    {!t.configured && <Badge tone="warn">needs setup</Badge>}
                  </div>
                  <p className="text-[11px] text-paper-400 leading-relaxed">{t.description}</p>
                </Card>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
