"use client";

import type { ChatSummary } from "@/types";
import { ChatList } from "./ChatList";

export function Sidebar({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onPinChat,
  onRenameChat,
  onDeleteChat,
}: {
  chats: ChatSummary[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onPinChat: (id: string, pinned: boolean) => void;
  onRenameChat: (id: string, title: string) => void;
  onDeleteChat: (id: string) => void;
}) {
  return (
    <aside className="w-[320px] shrink-0 border-r border-ink-600 bg-ink-850 flex flex-col h-full">
      <div className="px-5 pt-6 pb-3">
        <h1 className="font-serif text-2xl italic text-paper-100">The Conversation</h1>
      </div>

      <ChatList
        chats={chats}
        activeChatId={activeChatId}
        onSelect={onSelectChat}
        onNew={onNewChat}
        onPin={onPinChat}
        onRename={onRenameChat}
        onDelete={onDeleteChat}
      />
    </aside>
  );
}
