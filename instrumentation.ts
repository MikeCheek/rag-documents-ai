// Runs once when the Next.js server starts. Starts the background worker
// that ingests uploads and re-embeds documents (lib/jobs/worker.ts).
// Set DISABLE_BACKGROUND_WORKER=1 to run it separately (`npm run worker`),
// e.g. on a serverless host where requests can't keep a loop alive.

export async function register() {
  // Written as an if-block (not an early return) so webpack can drop the
  // import from the edge build, where the worker's native modules
  // (@napi-rs/canvas, onnxruntime) can't be bundled.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (
      process.env.NEXT_PHASE !== "phase-production-build" &&
      process.env.DISABLE_BACKGROUND_WORKER !== "1" &&
      process.env.DATABASE_URL
    ) {
      const { startWorker } = await import("./lib/jobs/worker");
      startWorker();
    }
  }
}
