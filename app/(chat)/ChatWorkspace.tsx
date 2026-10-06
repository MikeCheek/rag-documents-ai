"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ChatSummary, DocumentRecord } from "@/types";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";

/** The chat id in a /chat/<id> path, or null on "/" (a new, unsaved chat). */
export function chatIdFromPath(pathname: string | null): string | null {
  const match = pathname?.match(/^\/chat\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * The chat page: sidebar + conversation. Rendered by the (chat) layout, so
 * it stays mounted when moving between "/" and "/chat/<id>" — switching
 * chats swaps the conversation without reloading the sidebar.
 *
 * The URL is the source of truth for which chat is open: refreshing keeps
 * it, back/forward moves between chats, and a link opens it directly.
 */
export function ChatWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const activeChatId = chatIdFromPath(pathname);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  const openChat = (id: string | null) => router.push(id ? `/chat/${encodeURIComponent(id)}` : "/");

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

  // The tab title follows the open chat.
  const activeTitle = chats.find((c) => c.id === activeChatId)?.title;
  useEffect(() => {
    document.title = activeTitle ? `${activeTitle} · Reading Room` : "Reading Room";
  }, [activeTitle]);

  function handleChatCreated(chat: ChatSummary) {
    setChats((prev) => [chat, ...prev.filter((c) => c.id !== chat.id)]);
    // The first message of a new chat is still streaming in: swap the URL
    // in place (no navigation, no reload) so the answer isn't interrupted,
    // and "/" doesn't stay in history as a dead end.
    window.history.replaceState(null, "", `/chat/${encodeURIComponent(chat.id)}`);
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
    if (activeChatId === id) openChat(null);
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
        onSelectChat={(id) => openChat(id)}
        onNewChat={() => openChat(null)}
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
