// Tiny helper for a server route to stream newline-delimited JSON "events"
// to the client, so the UI can show pipeline stages, partial tokens, and a
// final payload all over one HTTP response.

export type StreamEvent =
  | { type: "stage"; stage: string; detail?: string }
  | { type: "token"; content: string }
  | { type: "token_reset" }
  | { type: "sources"; sources: unknown[]; rerankMethod: string | null }
  | { type: "agent_step"; step: unknown }
  | { type: "usage"; apiCallCount: number; durationMs: number }
  | { type: "document"; document: unknown }
  | { type: "chat"; chat: unknown }
  | { type: "done" }
  | { type: "error"; message: string };

export function createEventStream() {
  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
    cancel() {
      open = false;
    },
  });

  // Once the client disconnects (closed tab, navigated away) the stream is
  // cancelled and enqueue/close throw. Swallowing that lets the server
  // finish the turn and save it, so it's there when the chat is reopened,
  // instead of the error aborting it halfway through.
  let open = true;

  function send(event: StreamEvent) {
    if (!open) return;
    try {
      controllerRef?.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
    } catch {
      open = false;
    }
  }

  function close() {
    if (!open) return;
    open = false;
    try {
      controllerRef?.close();
    } catch {
      // Already closed or cancelled by the client.
    }
  }

  return { stream, send, close };
}
