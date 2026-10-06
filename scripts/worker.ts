// Runs the background worker on its own, outside the Next.js server:
//
//   npm run worker
//
// Only needed when the web server can't run it (serverless hosting, or
// DISABLE_BACKGROUND_WORKER=1). Several workers can run at once safely.

import { config } from "dotenv";

config({ path: ".env.local" });
config();

async function main() {
  const { startWorker } = await import("@/lib/jobs/worker");
  console.log("Background worker started. Ctrl+C to stop.");
  startWorker();
  await globalThis.__readingRoomWorker;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
