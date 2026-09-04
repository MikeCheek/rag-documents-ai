"use client";

import { useEffect, useState } from "react";
import type { ChatSummary, DocumentRecord } from "@/types";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";

export default function Home() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function loadChats() {
    try {
      const res = await fetch("/api/chats");
      const json = await res.json();
      setChats(json.chats ?? []);
    } catch {
      // best-effort
    }
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/documents")
        .then((res) => res.json())
        .then((data) => setDocuments(data.documents ?? []))
        .catch(() => {}),
      loadChats(),
    ]).finally(() => setLoaded(true));
  }, []);

  function handleChatCreated(chat: ChatSummary) {
    setChats((prev) => [chat, ...prev.filter((c) => c.id !== chat.id)]);
    setActiveChatId(chat.id);
  }

  async function handlePinChat(id: string, pinned: boolean) {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, pinned } : c)));
    await fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    }).catch(() => {});
    loadChats();
  }

  async function handleRenameChat(id: string, title: string) {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    await fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch(() => {});
  }

  async function handleDeleteChat(id: string) {
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (activeChatId === id) setActiveChatId(null);
    await fetch(`/api/chats/${id}`, { method: "DELETE" }).catch(() => {});
  }

  if (!loaded) {
    return <div className="h-full w-full bg-ink-900" />;
  }

  return (
    <main className="h-full w-full flex overflow-hidden">
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={setActiveChatId}
        onNewChat={() => setActiveChatId(null)}
        onPinChat={handlePinChat}
        onRenameChat={handleRenameChat}
        onDeleteChat={handleDeleteChat}
      />
      <ChatView
        chatId={activeChatId}
        documents={documents}
        onChatCreated={handleChatCreated}
        onChatTouched={loadChats}
      />
    </main>
  );
}
