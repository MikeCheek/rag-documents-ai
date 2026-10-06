"use client";

import { useEffect, useState } from "react";
import { Pencil, Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { McpServerRecord, McpToolInfo, McpTransportType } from "@/types";
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

const TRANSPORT_LABEL: Record<McpTransportType, string> = {
  http: "Streamable HTTP",
  sse: "HTTP + SSE (older servers)",
  stdio: "Local command (stdio)",
};

function ServerForm({
  editing,
  stdioAllowed,
  onDone,
  onCancel,
}: {
  editing?: McpServerRecord;
  stdioAllowed: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [transport, setTransport] = useState<McpTransportType>(editing?.transport ?? "http");
  const [url, setUrl] = useState(editing?.url ?? "");
  // Values are write-only: names come back, values stay blank (= unchanged).
  const [headers, setHeaders] = useState((editing?.headerNames ?? []).map((key) => ({ key, value: "" })));
  const [command, setCommand] = useState(editing?.command ?? "");
  const [args, setArgs] = useState((editing?.args ?? []).join("\n"));
  const [env, setEnv] = useState((editing?.envNames ?? []).map((key) => ({ key, value: "" })));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setSaving(true);
    const payload =
      transport === "stdio"
        ? { name, transport, command, args: args.split("\n").map((a) => a.trim()).filter(Boolean), env: rowsToRecord(env), url: null }
        : { name, transport, url, headers: rowsToRecord(headers) };
    try {
      if (editing) await api(`/api/mcp-servers/${editing.id}`, { method: "PATCH", json: payload });
      else await api("/api/mcp-servers", { method: "POST", json: payload });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title={editing ? `Edit ${editing.name}` : "Add MCP server"} onClose={onCancel}>
      <ErrorText>{error}</ErrorText>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name" hint="Its tools are offered to the model as name__tool.">
          <TextInput mono value={name} onChange={(e) => setName(e.target.value)} placeholder="github" />
        </Field>
        <Field label="Transport">
          <Select value={transport} onChange={(e) => setTransport(e.target.value as McpTransportType)}>
            {(Object.keys(TRANSPORT_LABEL) as McpTransportType[]).map((t) => (
              <option key={t} value={t} disabled={t === "stdio" && !stdioAllowed}>
                {TRANSPORT_LABEL[t]}
                {t === "stdio" && !stdioAllowed ? " (needs ALLOW_MCP_STDIO=1)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {transport === "stdio" ? (
        <>
          <p className="text-[11px] text-brass-300 leading-relaxed">
            This runs a program on the server hosting this app, with its permissions. Only add commands you trust.
          </p>
          <Field label="Command">
            <TextInput mono value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
          </Field>
          <Field label="Arguments (one per line)">
            <TextArea mono rows={3} value={args} onChange={(e) => setArgs(e.target.value)} placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path/to/folder"} />
          </Field>
          <Field label="Environment variables" hint={editing ? "Values are hidden; leave blank to keep them." : undefined}>
            <KeyValueRows rows={env} onChange={setEnv} keyPlaceholder="API_TOKEN" valuePlaceholder={editing ? "unchanged" : "value"} secret />
          </Field>
        </>
      ) : (
        <>
          <Field label="Server URL">
            <TextInput mono value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
          </Field>
          <Field
            label="Headers (e.g. Authorization)"
            hint={editing ? "Values are hidden; leave blank to keep them." : "Stored on the server and never sent back to the browser."}
          >
            <KeyValueRows rows={headers} onChange={setHeaders} keyPlaceholder="Authorization" valuePlaceholder={editing ? "unchanged" : "Bearer ..."} secret />
          </Field>
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
        <PrimaryButton onClick={save} disabled={saving || !name.trim() || (transport === "stdio" ? !command.trim() : !url.trim())}>
          {saving ? "Saving..." : editing ? "Save" : "Add server"}
        </PrimaryButton>
      </div>
    </Panel>
  );
}

/** Connects to the server and lists its tools, with a switch for each. */
function ServerTools({ server, onChanged }: { server: McpServerRecord; onChanged: () => void }) {
  const [tools, setTools] = useState<McpToolInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ tools: McpToolInfo[]; durationMs: number }>(`/api/mcp-servers/${server.id}/tools`);
      setTools(res.tools);
      setDuration(res.durationMs);
    } catch (err: any) {
      setError(err.message);
      setTools(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  async function toggle(tool: McpToolInfo) {
    const disabled = new Set(server.disabledTools);
    if (tool.enabled) disabled.add(tool.name);
    else disabled.delete(tool.name);
    setTools((prev) => prev?.map((t) => (t.name === tool.name ? { ...t, enabled: !t.enabled } : t)) ?? null);
    await api(`/api/mcp-servers/${server.id}`, { method: "PATCH", json: { disabledTools: [...disabled] } }).catch((e) => setError(e.message));
    onChanged();
  }

  return (
    <div className="mt-2 border-t border-ink-700 pt-2">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] text-paper-400">
          {loading
            ? "Connecting..."
            : tools
              ? `Connected in ${duration} ms · ${tools.filter((t) => t.enabled).length} of ${tools.length} tools offered to the agent`
              : ""}
        </p>
        <button onClick={load} className="text-paper-400 hover:text-paper-200 p-0.5" aria-label="Reconnect" title="Reconnect">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
      {tools && (
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          {tools.map((t) => (
            <label key={t.name} className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={t.enabled} onChange={() => toggle(t)} className="mt-0.5" />
              <span className="min-w-0">
                <span className={cn("font-mono", t.enabled ? "text-paper-200" : "text-paper-400")}>{t.name}</span>
                {t.description && <span className="block text-[11px] text-paper-400 line-clamp-2">{t.description}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function McpServersManager() {
  const [servers, setServers] = useState<McpServerRecord[]>([]);
  const [stdioAllowed, setStdioAllowed] = useState(false);
  const [mode, setMode] = useState<null | "new" | { edit: McpServerRecord }>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api<{ servers: McpServerRecord[]; stdioAllowed: boolean }>("/api/mcp-servers");
      setServers(res.servers);
      setStdioAllowed(res.stdioAllowed);
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function toggleEnabled(s: McpServerRecord) {
    setServers((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)));
    await api(`/api/mcp-servers/${s.id}`, { method: "PATCH", json: { enabled: !s.enabled } }).catch(() => load());
  }

  async function remove(s: McpServerRecord) {
    if (!confirm(`Remove the MCP server "${s.name}"?`)) return;
    await api(`/api/mcp-servers/${s.id}`, { method: "DELETE" }).catch((e) => setError(e.message));
    load();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-paper-400 leading-relaxed max-w-prose">
          Connect{" "}
          <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer" className="text-brass-300 hover:underline">
            Model Context Protocol
          </a>{" "}
          servers and the agent can use their tools. Each enabled server is connected for every Agent-mode answer.
        </p>
        {!mode && (
          <LinkButton onClick={() => setMode("new")} className="shrink-0">
            <Plus size={13} /> Add server
          </LinkButton>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      {mode && (
        <ServerForm
          editing={typeof mode === "object" ? mode.edit : undefined}
          stdioAllowed={stdioAllowed}
          onDone={() => {
            setMode(null);
            load();
          }}
          onCancel={() => setMode(null)}
        />
      )}
      {servers.length === 0 && !mode && <p className="text-xs text-paper-400">No MCP servers yet.</p>}
      {servers.map((s) => (
        <Card key={s.id} dim={!s.enabled}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                <Plug size={12} className={s.enabled ? "text-brass-300" : "text-paper-400"} />
                <span className="text-xs font-mono text-paper-200">{s.name}</span>
                <Badge>{s.transport}</Badge>
                {s.headerNames.length > 0 && <Badge tone="ok">{s.headerNames.join(", ")}</Badge>}
                {s.disabledTools.length > 0 && <Badge>{s.disabledTools.length} tool(s) off</Badge>}
              </div>
              <p className="text-[10px] font-mono text-paper-400 truncate">
                {s.transport === "stdio" ? [s.command, ...s.args].join(" ") : s.url}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => toggleEnabled(s)}
                className={cn(
                  "text-[11px] px-2 py-1 rounded-full border transition-colors mr-1",
                  s.enabled ? "border-teal-500/40 text-teal-400" : "border-ink-600 text-paper-400"
                )}
              >
                {s.enabled ? "Enabled" : "Disabled"}
              </button>
              <LinkButton onClick={() => setOpen(open === s.id ? null : s.id)} className="mr-1">
                {open === s.id ? "Hide tools" : "Tools"}
              </LinkButton>
              <button onClick={() => setMode({ edit: s })} className="text-paper-400 hover:text-paper-200 p-1" aria-label={`Edit ${s.name}`}>
                <Pencil size={13} />
              </button>
              <button onClick={() => remove(s)} className="text-paper-400 hover:text-rust-400 p-1" aria-label={`Remove ${s.name}`}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          {open === s.id && <ServerTools server={s} onChanged={load} />}
        </Card>
      ))}
    </div>
  );
}
