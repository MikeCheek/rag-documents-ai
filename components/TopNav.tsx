"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, LayoutGrid, Orbit, SlidersHorizontal, LayoutDashboard, LogOut } from "lucide-react";
import { ModeToggle } from "./ModeToggle";
import { cn } from "@/lib/utils";
import { UsageCircles } from "./UsageCircles";

const NAV_ITEMS = [
  { href: "/", label: "Chat", icon: MessageSquare },
  { href: "/shelf", label: "Shelf", icon: LayoutGrid },
  { href: "/constellation", label: "Constellation", icon: Orbit },
  { href: "/dashboard", label: "Ledger", icon: LayoutDashboard },
  { href: "/settings", label: "Method", icon: SlidersHorizontal },
];

/** Who's signed in, when sign-in is enabled (APP_PASSWORD). */
function useSession() {
  const [username, setUsername] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s: { enabled: boolean; username: string | null }) => setUsername(s.enabled ? s.username : null))
      .catch(() => {});
  }, []);
  return username;
}

/**
 * When a session expires while the app is open, API calls start failing
 * with 401: send the user to sign in again (and back here afterwards)
 * instead of leaving every panel showing errors.
 */
function useRedirectOnSignedOut() {
  useEffect(() => {
    const original = window.fetch;
    let redirecting = false;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
      const path = new URL(url, window.location.href).pathname;
      if (res.status === 401 && path.startsWith("/api/") && !path.startsWith("/api/auth/") && !redirecting) {
        redirecting = true;
        const here = window.location.pathname + window.location.search;
        window.location.assign(`/login?next=${encodeURIComponent(here)}`);
      }
      return res;
    };
    return () => {
      window.fetch = original;
    };
  }, []);
}

export function TopNav() {
  const pathname = usePathname();
  const username = useSession();
  useRedirectOnSignedOut();

  // The login page stands alone.
  if (pathname === "/login") return null;

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.assign("/login");
  }

  return (
    <header className="h-14 shrink-0 border-b border-ink-600 bg-ink-850 flex items-center justify-between px-4">
      <div className="flex items-center gap-1 min-w-0">
        <Link
          href="/"
          className="font-serif italic text-lg text-paper-100 mr-3 shrink-0 whitespace-nowrap"
        >
          Reading Room
        </Link>
        <nav className="flex items-center gap-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            // "/chat/<id>" is still the Chat tab.
            const active = pathname === item.href || (item.href === "/" && !!pathname?.startsWith("/chat/"));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border whitespace-nowrap transition-colors",
                  active
                    ? "border-brass-400/60 text-brass-300 bg-brass-400/5"
                    : "border-transparent text-paper-400 hover:text-paper-200 hover:bg-ink-800"
                )}
              >
                <Icon size={14} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-3 shrink-0 pl-3">
        <ModeToggle />
        <UsageCircles />
        {username && (
          <button
            onClick={signOut}
            title={`Signed in as ${username}`}
            className="flex items-center gap-1.5 text-xs text-paper-400 hover:text-paper-200 px-2 py-1.5 rounded-lg hover:bg-ink-800 transition-colors"
          >
            <LogOut size={14} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        )}
      </div>
    </header>
  );
}
