"use client";

import { Pin, PinOff, Plus, Trash2, MessageSquare } from "lucide-react";
import type { ChatSummary } from "@/types";
import { relativeTime, cn } from "@/lib/utils";
import { InlineEditableText } from "./InlineEditableText";

export function ChatList({
  chats,
  activeChatId,
  onSelect,
  onNew,
  onPin,
  onRename,
  onDelete,
}: {
  chats: ChatSummary[];
  activeChatId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onPin: (id: string, pinned: boolean) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const pinned = chats.filter((c) => c.pinned);
  const recent = chats.filter((c) => !c.pinned);

  return (
    <div className="flex-1 overflow-y-auto px-2.5 py-3 flex flex-col gap-4">
      <button
        onClick={onNew}
        className="flex items-center gap-2 rounded-lg border border-dashed border-ink-600 hover:border-brass-400/50 hover:bg-ink-800 text-sm text-paper-300 px-3 py-2 transition-colors mx-0.5"
      >
        <Plus size={15} />
        New chat
      </button>

      {chats.length === 0 && (
        <p className="text-sm text-paper-400 px-1.5 py-4 text-center leading-relaxed">
          No conversations yet.
          <br />
          Ask something to start one.
        </p>
      )}

      {pinned.length > 0 && (
        <ChatGroup
          label="Pinned"
          chats={pinned}
          activeChatId={activeChatId}
          onSelect={onSelect}
          onPin={onPin}
          onRename={onRename}
          onDelete={onDelete}
        />
      )}

      {recent.length > 0 && (
        <ChatGroup
          label={pinned.length > 0 ? "Other chats" : undefined}
          chats={recent}
          activeChatId={activeChatId}
          onSelect={onSelect}
          onPin={onPin}
          onRename={onRename}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

function ChatGroup({
  label,
  chats,
  activeChatId,
  onSelect,
  onPin,
  onRename,
  onDelete,
}: {
  label?: string;
  chats: ChatSummary[];
  activeChatId: string | null;
  onSelect: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      {label && <p className="text-[11px] text-paper-400 px-1.5 mb-1.5">{label}</p>}
      <ul className="flex flex-col gap-0.5">
        {chats.map((chat) => (
          <li
            key={chat.id}
            onClick={() => onSelect(chat.id)}
            className={cn(
              "group flex items-start gap-2 rounded-md px-2 py-2 cursor-pointer transition-colors",
              activeChatId === chat.id ? "bg-ink-700" : "hover:bg-ink-800"
            )}
          >
            <MessageSquare
              size={14}
              className={cn(
                "mt-0.5 shrink-0",
                activeChatId === chat.id ? "text-brass-300" : "text-paper-400"
              )}
            />
            <div className="min-w-0 flex-1" onDoubleClick={(e) => e.stopPropagation()}>
              <InlineEditableText
                value={chat.title}
                onSave={(next) => onRename(chat.id, next)}
                className="text-sm text-paper-200 truncate block"
                inputClassName="text-sm text-paper-200"
              />
              <p className="text-[11px] text-paper-400 mt-0.5">{relativeTime(chat.updatedAt)}</p>
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPin(chat.id, !chat.pinned);
                }}
                className="text-paper-400 hover:text-brass-300 p-1"
                aria-label={chat.pinned ? "Unpin chat" : "Pin chat"}
              >
                {chat.pinned ? <PinOff size={13} /> : <Pin size={13} />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${chat.title}"? This can't be undone.`)) {
                    onDelete(chat.id);
                  }
                }}
                className="text-paper-400 hover:text-rust-400 p-1"
                aria-label="Delete chat"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
