// Tiny helper for a server route to stream newline-delimited JSON "events"
// to the client, so the UI can show pipeline stages, partial tokens, and a
// final payload all over one HTTP response.

export type StreamEvent =
  | { type: "stage"; stage: string; detail?: string }
  | { type: "token"; content: string }
  | { type: "sources"; sources: unknown[]; rerankMethod: string }
  | { type: "agent_step"; step: unknown }
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
  });

  function send(event: StreamEvent) {
    controllerRef?.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
  }

  function close() {
    controllerRef?.close();
  }

  return { stream, send, close };
}
