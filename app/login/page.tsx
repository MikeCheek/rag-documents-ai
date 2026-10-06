"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, EyeOff, Lock } from "lucide-react";
import { safeNextPath } from "@/lib/auth/session";

function LoginForm() {
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, remember }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Sign-in failed.");
        setPassword("");
        return;
      }
      // A full navigation, so every part of the app starts fresh as signed in.
      window.location.assign(next);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-ink-600 bg-ink-850 p-7 shadow-2xl" noValidate>
      <div className="flex items-center justify-center h-10 w-10 rounded-full border border-brass-400/50 text-brass-300 mx-auto mb-4">
        <Lock size={16} />
      </div>
      <h1 className="font-serif italic text-2xl text-paper-100 text-center">Reading Room</h1>
      <p className="text-sm text-paper-400 text-center mt-1 mb-6">Sign in to continue to your documents.</p>

      <label className="block text-xs text-paper-400 mb-1" htmlFor="username">
        Username
      </label>
      <input
        id="username"
        name="username"
        autoComplete="username"
        autoFocus
        required
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-paper-200 outline-none focus:border-brass-400/60 mb-4"
      />

      <label className="block text-xs text-paper-400 mb-1" htmlFor="password">
        Password
      </label>
      <div className="relative mb-4">
        <input
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 pr-10 text-sm text-paper-200 outline-none focus:border-brass-400/60"
        />
        <button
          type="button"
          onClick={() => setShowPassword((s) => !s)}
          className="absolute inset-y-0 right-0 px-3 text-paper-400 hover:text-paper-200"
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>

      <label className="flex items-center gap-2 text-xs text-paper-300 mb-5 select-none">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Keep me signed in for 30 days
      </label>

      {error && (
        <p role="alert" className="text-xs text-rust-400 mb-4">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !username.trim() || !password}
        className="w-full rounded-lg bg-brass-400 text-ink-950 text-sm font-medium py-2 hover:bg-brass-300 disabled:opacity-40 transition-colors"
      >
        {busy ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-full flex items-center justify-center px-4 py-10">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
