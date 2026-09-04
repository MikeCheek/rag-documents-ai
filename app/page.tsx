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

  function handleDocumentUpdate(doc: DocumentRecord) {
    setDocuments((prev) => {
      const exists = prev.some((d) => d.id === doc.id);
      if (exists) return prev.map((d) => (d.id === doc.id ? doc : d));
      return [doc, ...prev];
    });
  }

  async function handleDeleteDocument(id: string) {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    await fetch(`/api/documents/${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function handleRenameDocument(id: string, name: string) {
    setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
    await fetch(`/api/documents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => {});
  }

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
    return <div className="h-screen w-screen bg-ink-900" />;
  }

  return (
    <main className="h-screen w-screen flex overflow-hidden">
      <Sidebar
        documents={documents}
        onDocumentUpdate={handleDocumentUpdate}
        onDeleteDocument={handleDeleteDocument}
        onRenameDocument={handleRenameDocument}
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
