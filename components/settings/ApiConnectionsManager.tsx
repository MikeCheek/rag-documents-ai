"use client";

import { useEffect, useState } from "react";
import { FileJson, Globe, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import type { ApiAuthType, ApiConnectionRecord } from "@/types";
import type { ImportedOperation, ImportedSpec } from "@/lib/agent/openapi";
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

const AUTH_LABEL: Record<ApiAuthType, string> = {
  none: "No auth",
  bearer: "Bearer token",
  header: "API key in a header",
  query: "API key in the query string",
};

type ConnectionDraft = {
  name: string;
  baseUrl: string;
  authType: ApiAuthType;
  authName: string;
  authValue: string;
  clearSecret: boolean;
  headers: { key: string; value: string }[];
  allowPrivateNetwork: boolean;
};

function emptyDraft(): ConnectionDraft {
  return {
    name: "",
    baseUrl: "",
    authType: "none",
    authName: "",
    authValue: "",
    clearSecret: false,
    headers: [],
    allowPrivateNetwork: false,
  };
}

function draftFrom(c: ApiConnectionRecord): ConnectionDraft {
  return {
    name: c.name,
    baseUrl: c.baseUrl,
    authType: c.authType,
    authName: c.authName ?? "",
    authValue: "",
    clearSecret: false,
    // Header values are write-only: names come back, values stay blank (= unchanged).
    headers: c.headerNames.map((key) => ({ key, value: "" })),
    allowPrivateNetwork: c.allowPrivateNetwork,
  };
}

function ConnectionFields({
  draft,
  setDraft,
  editing,
}: {
  draft: ConnectionDraft;
  setDraft: (d: ConnectionDraft) => void;
  editing?: ApiConnectionRecord;
}) {
  const set = (patch: Partial<ConnectionDraft>) => setDraft({ ...draft, ...patch });
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name">
          <TextInput value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="GitHub" />
        </Field>
        <Field label="Base URL">
          <TextInput mono value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://api.github.com" />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Authentication">
          <Select value={draft.authType} onChange={(e) => set({ authType: e.target.value as ApiAuthType })}>
            {(Object.keys(AUTH_LABEL) as ApiAuthType[]).map((t) => (
              <option key={t} value={t}>
                {AUTH_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        {(draft.authType === "header" || draft.authType === "query") && (
          <Field label={draft.authType === "header" ? "Header name" : "Query parameter name"}>
            <TextInput
              mono
              value={draft.authName}
              onChange={(e) => set({ authName: e.target.value })}
              placeholder={draft.authType === "header" ? "X-API-Key" : "api_key"}
            />
          </Field>
        )}
      </div>
      {draft.authType !== "none" && (
        <Field
          label={draft.authType === "bearer" ? "Token" : "Key"}
          hint={
            editing?.hasSecret
              ? "Stored and never shown again. Leave blank to keep it."
              : "Stored on the server and never sent back to the browser."
          }
        >
          <TextInput
            type="password"
            autoComplete="off"
            value={draft.authValue}
            onChange={(e) => set({ authValue: e.target.value, clearSecret: false })}
            placeholder={editing?.hasSecret ? "•••••••• (unchanged)" : ""}
          />
        </Field>
      )}
      <Field label="Extra headers (optional, sent with every request)">
        <KeyValueRows
          rows={draft.headers}
          onChange={(headers) => set({ headers })}
          keyPlaceholder="Accept-Language"
          valuePlaceholder={editing ? "unchanged" : "value"}
        />
      </Field>
      <label className="flex items-start gap-2 text-xs text-paper-400">
        <input
          type="checkbox"
          checked={draft.allowPrivateNetwork}
          onChange={(e) => set({ allowPrivateNetwork: e.target.checked })}
          className="mt-0.5"
        />
        <span>
          Allow a private-network address (localhost, 192.168.x, ...) for this base URL.{" "}
          <span className="text-paper-400/80">
            Only this connection's own host is allowed; the model can only fill in path and query values, never change the host.
          </span>
        </span>
      </label>
    </>
  );
}

function draftPayload(draft: ConnectionDraft, editing?: ApiConnectionRecord) {
  return {
    name: draft.name,
    baseUrl: draft.baseUrl,
    authType: draft.authType,
    authName: draft.authName,
    authValue: draft.authValue,
    headers: rowsToRecord(draft.headers),
    allowPrivateNetwork: draft.allowPrivateNetwork,
  };
}

function ConnectionForm({
  editing,
  onDone,
  onCancel,
}: {
  editing?: ApiConnectionRecord;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ConnectionDraft>(editing ? draftFrom(editing) : emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      // Blank header values mean "keep the stored value" (merged server-side).
      const payload = draftPayload(draft, editing);
      if (editing) await api(`/api/api-connections/${editing.id}`, { method: "PATCH", json: payload });
      else await api("/api/api-connections", { method: "POST", json: payload });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title={editing ? `Edit ${editing.name}` : "New API connection"} onClose={onCancel}>
      <ErrorText>{error}</ErrorText>
      <ConnectionFields draft={draft} setDraft={setDraft} editing={editing} />
      <div className="flex justify-end gap-2 pt-1">
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
        <PrimaryButton onClick={save} disabled={saving || !draft.name.trim() || !draft.baseUrl.trim()}>
          {saving ? "Saving..." : editing ? "Save" : "Create connection"}
        </PrimaryButton>
      </div>
    </Panel>
  );
}

/** Reads an OpenAPI spec, lets the user pick operations, creates a connection + tools. */
function OpenApiImport({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [source, setSource] = useState<"url" | "text">("url");
  const [specUrl, setSpecUrl] = useState("");
  const [specText, setSpecText] = useState("");
  const [spec, setSpec] = useState<ImportedSpec | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prefix, setPrefix] = useState("");
  const [draft, setDraft] = useState<ConnectionDraft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function read() {
    setError(null);
    setBusy(true);
    try {
      const result = await api<ImportedSpec>("/api/api-connections/openapi", {
        method: "POST",
        json: source === "url" ? { url: specUrl } : { text: specText },
      });
      setSpec(result);
      setSelected(new Set(result.operations.filter((o) => !o.unsupported).slice(0, 20).map((o) => o.name)));
      setDraft({
        ...emptyDraft(),
        name: result.title.slice(0, 60),
        baseUrl: result.baseUrl,
        authType: result.auth?.type ?? "none",
        authName: result.auth?.name ?? "",
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!spec) return;
    setError(null);
    setBusy(true);
    try {
      const tools = spec.operations
        .filter((o) => selected.has(o.name))
        .map((o: ImportedOperation) => ({
          name: (prefix + o.name).slice(0, 64),
          description: o.description,
          method: o.method,
          urlTemplate: o.urlTemplate,
          parameters: o.parameters,
        }));
      await api("/api/api-connections", { method: "POST", json: { ...draftPayload(draft), tools } });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <Panel title="Import from OpenAPI" onClose={onCancel}>
      <ErrorText>{error}</ErrorText>
      {!spec ? (
        <>
          <div className="flex gap-3 text-xs">
            {(["url", "text"] as const).map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-paper-300">
                <input type="radio" checked={source === s} onChange={() => setSource(s)} />
                {s === "url" ? "From a URL" : "Paste the spec"}
              </label>
            ))}
          </div>
          {source === "url" ? (
            <Field label="Spec URL (JSON or YAML)" hint="OpenAPI 3.x or Swagger 2.0.">
              <TextInput mono value={specUrl} onChange={(e) => setSpecUrl(e.target.value)} placeholder="https://petstore3.swagger.io/api/v3/openapi.json" />
            </Field>
          ) : (
            <Field label="Spec (JSON or YAML)">
              <TextArea mono rows={8} value={specText} onChange={(e) => setSpecText(e.target.value)} placeholder="openapi: 3.0.0 ..." />
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <GhostButton onClick={onCancel}>Cancel</GhostButton>
            <PrimaryButton onClick={read} disabled={busy || (source === "url" ? !specUrl.trim() : !specText.trim())}>
              {busy ? "Reading..." : "Read spec"}
            </PrimaryButton>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-paper-300">
            <span className="text-paper-200">{spec.title}</span>: {spec.operations.length} operation
            {spec.operations.length === 1 ? "" : "s"}
            {spec.auth && <> · auth detected: {spec.auth.description}</>}
          </p>
          <ConnectionFields draft={draft} setDraft={setDraft} />
          <div className="flex items-end justify-between gap-3">
            <Field label="Tool name prefix (optional, avoids clashes)" className="flex-1">
              <TextInput mono value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="petstore_" />
            </Field>
            <div className="flex gap-2 pb-1.5">
              <LinkButton onClick={() => setSelected(new Set(spec.operations.filter((o) => !o.unsupported).map((o) => o.name)))}>
                All
              </LinkButton>
              <LinkButton onClick={() => setSelected(new Set())}>None</LinkButton>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto flex flex-col gap-1 rounded border border-ink-600 p-2">
            {spec.operations.map((o) => (
              <label
                key={o.name}
                className={`flex items-start gap-2 text-xs ${o.unsupported ? "opacity-50" : "text-paper-300"}`}
                title={o.unsupported ? `Can't import: ${o.unsupported}` : o.description}
              >
                <input type="checkbox" disabled={!!o.unsupported} checked={selected.has(o.name)} onChange={() => toggle(o.name)} className="mt-0.5" />
                <span className="font-mono text-[10px] w-12 shrink-0 text-paper-400">{o.method}</span>
                <span className="min-w-0">
                  <span className="font-mono text-paper-200">{prefix + o.name}</span>{" "}
                  <span className="font-mono text-paper-400/80">{o.path}</span>
                  {o.unsupported && <span className="block text-rust-400">Can&apos;t import: {o.unsupported}</span>}
                </span>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-paper-400">
            Every tool offered to the model adds to its prompt; pick the operations you actually want the agent to use.
          </p>
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setSpec(null)}>Back</GhostButton>
            <PrimaryButton onClick={create} disabled={busy || !draft.name.trim() || !draft.baseUrl.trim() || selected.size === 0}>
              {busy ? "Creating..." : `Create connection + ${selected.size} tool${selected.size === 1 ? "" : "s"}`}
            </PrimaryButton>
          </div>
        </>
      )}
    </Panel>
  );
}

export function ApiConnectionsManager({ onChanged }: { onChanged: () => void }) {
  const [connections, setConnections] = useState<ApiConnectionRecord[]>([]);
  const [mode, setMode] = useState<null | "new" | "import" | { edit: ApiConnectionRecord }>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setConnections((await api<{ connections: ApiConnectionRecord[] }>("/api/api-connections")).connections);
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const done = () => {
    setMode(null);
    load();
    onChanged();
  };

  async function remove(c: ApiConnectionRecord) {
    if (!confirm(`Delete "${c.name}"${c.toolCount ? ` and its ${c.toolCount} tool${c.toolCount === 1 ? "" : "s"}` : ""}?`)) return;
    try {
      await api(`/api/api-connections/${c.id}`, { method: "DELETE" });
      done();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-paper-400 leading-relaxed max-w-prose">
          A base URL and credentials, set once and shared by any number of tools. Secrets stay on the server.
        </p>
        {!mode && (
          <div className="flex gap-3 shrink-0">
            <LinkButton onClick={() => setMode("import")}>
              <FileJson size={13} /> Import OpenAPI
            </LinkButton>
            <LinkButton onClick={() => setMode("new")}>
              <Plus size={13} /> Add connection
            </LinkButton>
          </div>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      {mode === "new" && <ConnectionForm onDone={done} onCancel={() => setMode(null)} />}
      {mode === "import" && <OpenApiImport onDone={done} onCancel={() => setMode(null)} />}
      {mode && typeof mode === "object" && <ConnectionForm editing={mode.edit} onDone={done} onCancel={() => setMode(null)} />}

      {connections.length === 0 && !mode && <p className="text-xs text-paper-400">No API connections yet.</p>}
      {connections.map((c) => (
        <Card key={c.id} className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <Globe size={12} className="text-brass-300 shrink-0" />
              <span className="text-xs text-paper-200">{c.name}</span>
              <Badge>
                {c.toolCount} tool{c.toolCount === 1 ? "" : "s"}
              </Badge>
              {c.authType !== "none" && (
                <Badge tone={c.hasSecret ? "ok" : "warn"}>
                  <KeyRound size={9} className="inline mr-0.5 -mt-px" />
                  {c.hasSecret ? AUTH_LABEL[c.authType] : "secret missing"}
                </Badge>
              )}
              {c.allowPrivateNetwork && <Badge tone="warn">private network</Badge>}
            </div>
            <p className="text-[10px] font-mono text-paper-400 truncate">{c.baseUrl}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setMode({ edit: c })} className="text-paper-400 hover:text-paper-200 p-1" aria-label={`Edit ${c.name}`}>
              <Pencil size={13} />
            </button>
            <button onClick={() => remove(c)} className="text-paper-400 hover:text-rust-400 p-1" aria-label={`Delete ${c.name}`}>
              <Trash2 size={13} />
            </button>
          </div>
        </Card>
      ))}
    </div>
  );
}
