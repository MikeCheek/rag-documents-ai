import { ChatWorkspace } from "./ChatWorkspace";

// Shared by "/" (new chat) and "/chat/[id]". The workspace reads the chat
// id from the URL; the pages themselves render nothing, so moving between
// chats keeps this layout (and the sidebar) mounted.
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChatWorkspace />
      {children}
    </>
  );
}
