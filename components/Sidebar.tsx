"use client";

import { useState } from "react";
import Link from "next/link";
import { LayoutDashboard, SlidersHorizontal } from "lucide-react";
import type { ChatSummary, DocumentRecord } from "@/types";
import { UploadZone } from "./UploadZone";
import { DocumentList } from "./DocumentList";
import { ChatList } from "./ChatList";
import { UsageDots } from "./UsageDots";
import { cn } from "@/lib/utils";

type Tab = "chats" | "shelf";

export function Sidebar({
  documents,
  onDocumentUpdate,
  onDeleteDocument,
  onRenameDocument,
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onPinChat,
  onRenameChat,
  onDeleteChat,
}: {
  documents: DocumentRecord[];
  onDocumentUpdate: (doc: DocumentRecord) => void;
  onDeleteDocument: (id: string) => void;
  onRenameDocument: (id: string, name: string) => void;
  chats: ChatSummary[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onPinChat: (id: string, pinned: boolean) => void;
  onRenameChat: (id: string, title: string) => void;
  onDeleteChat: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("chats");

  return (
    <aside className="w-[320px] shrink-0 border-r border-ink-600 bg-ink-850 flex flex-col h-full">
      <div className="px-5 pt-6 pb-3 flex items-start justify-between gap-3">
        <h1 className="font-serif text-2xl italic text-paper-100">
          {tab === "chats" ? "The Conversation" : "The Shelf"}
        </h1>
        <div className="flex items-center gap-2.5 mt-1.5 shrink-0">
          <UsageDots />
          <Link
            href="/settings"
            title="Adjust query & reranking settings"
            className="flex items-center justify-center h-8 w-8 rounded-lg border border-ink-600 text-paper-400 hover:text-brass-300 hover:border-brass-400/50 transition-colors"
          >
            <SlidersHorizontal size={15} />
          </Link>
          <Link
            href="/dashboard"
            title="Open the ledger"
            className="flex items-center justify-center h-8 w-8 rounded-lg border border-ink-600 text-paper-400 hover:text-brass-300 hover:border-brass-400/50 transition-colors"
          >
            <LayoutDashboard size={15} />
          </Link>
        </div>
      </div>

      <div className="px-5 flex items-center gap-1 mb-2">
        {(["chats", "shelf"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              tab === t
                ? "border-brass-400/60 text-brass-300 bg-brass-400/5"
                : "border-transparent text-paper-400 hover:text-paper-200"
            )}
          >
            {t === "chats" ? "Chats" : "Shelf"}
          </button>
        ))}
      </div>

      {tab === "shelf" ? (
        <>
          <div className="px-4">
            <UploadZone onDocumentUpdate={onDocumentUpdate} />
          </div>
          <div className="flex-1 overflow-y-auto px-2.5 py-4 mt-1">
            <DocumentList
              documents={documents}
              onDelete={onDeleteDocument}
              onRename={onRenameDocument}
            />
          </div>
        </>
      ) : (
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onSelect={onSelectChat}
          onNew={onNewChat}
          onPin={onPinChat}
          onRename={onRenameChat}
          onDelete={onDeleteChat}
        />
      )}
    </aside>
  );
}
