import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  sublabel,
  accent = "paper",
}: {
  label: string;
  value: string;
  sublabel?: string;
  accent?: "paper" | "brass" | "teal" | "rust";
}) {
  const accentClass = {
    paper: "text-paper-100",
    brass: "text-brass-300",
    teal: "text-teal-400",
    rust: "text-rust-400",
  }[accent];

  return (
    <div className="rounded-lg border border-ink-600 bg-ink-800 px-5 py-4">
      <p className="text-xs text-paper-400">{label}</p>
      <p className={cn("font-serif text-3xl mt-1.5", accentClass)}>{value}</p>
      {sublabel && <p className="text-xs text-paper-400 mt-1">{sublabel}</p>}
    </div>
  );
}
