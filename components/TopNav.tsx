"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, LayoutGrid, Orbit, SlidersHorizontal, LayoutDashboard } from "lucide-react";
import { UsageDots } from "./UsageDots";
import { ModeToggle } from "./ModeToggle";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Chat", icon: MessageSquare },
  { href: "/shelf", label: "Shelf", icon: LayoutGrid },
  { href: "/constellation", label: "Constellation", icon: Orbit },
  { href: "/settings", label: "Method", icon: SlidersHorizontal },
  { href: "/dashboard", label: "Ledger", icon: LayoutDashboard },
];

export function TopNav() {
  const pathname = usePathname();

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
            const active = pathname === item.href;
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
        <UsageDots />
      </div>
    </header>
  );
}
