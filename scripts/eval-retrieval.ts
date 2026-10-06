// Measures retrieval quality on your own documents, for every combination
// of query optimization and reranking, so a settings change (or a code
// change to chunking/search) can be judged by numbers instead of by feel.
//
//   cp eval/questions.example.json eval/questions.json   # then edit it
//   npm run eval                     # off/local query optimization
//   npm run eval -- --llm            # also the LLM rewrite (1 OpenRouter call per question)
//   npm run eval -- path/to/file.json
//
// Each case names the document that answers the question and, optionally,
// a phrase the answering passage must contain. Uses your real database and
// local embedding model; documents must already be uploaded. Cohere is
// included when COHERE_API_KEY is set (1 call per question).
//
// Note: like real chats, runs are logged as API usage and bump the
// passage-usage counters shown in the Ledger.

import { readFile } from "node:fs/promises";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

async function main() {
  const args = process.argv.slice(2);
  const includeLlm = args.includes("--llm");
  const file = args.find((a) => !a.startsWith("--")) ?? "eval/questions.json";

  const { validateCases, firstHitRank, summarize } = await import("@/lib/eval/score");
  const { runRetrievalPipeline } = await import("@/lib/rag/pipeline");
  const { getSettings } = await import("@/lib/rag/settings");
  const { TimingCollector } = await import("@/lib/rag/timing");

  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch {
    console.error(`No eval file at ${file}. Copy eval/questions.example.json to eval/questions.json and edit it.`);
    process.exit(1);
  }
  const cases = validateCases(JSON.parse(raw));
  const base = await getSettings();

  const optimizations = (["off", "local", ...(includeLlm ? ["llm"] : [])] as const);
  const reranks = (["off", "bm25", ...(process.env.COHERE_API_KEY ? ["cohere"] : [])] as const);

  console.log(`${cases.length} question(s) from ${file}\n`);
  const rows: string[][] = [];
  const misses = new Map<string, string[]>();

  for (const queryOptimization of optimizations) {
    for (const rerankMethod of reranks) {
      const settings = { ...base, queryOptimization, rerankMethod } as typeof base;
      const ranks: (number | null)[] = [];
      for (const c of cases) {
        const { sources } = await runRetrievalPipeline(c.question, [], null, settings, () => {}, new TimingCollector());
        const rank = firstHitRank(c, sources);
        ranks.push(rank);
        if (rank === null) {
          const key = c.question;
          misses.set(key, [...(misses.get(key) ?? []), `${queryOptimization}/${rerankMethod}`]);
        }
      }
      const s = summarize(ranks);
      const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(5);
      rows.push([queryOptimization.padEnd(6), rerankMethod.padEnd(7), pct(s.hitAt1), pct(s.hitAtK), s.mrr.toFixed(2).padStart(5)]);
    }
  }

  console.log("query   rerank   hit@1  hit@5   MRR");
  for (const r of rows) console.log(r.join("  "));

  if (misses.size) {
    console.log("\nMissed (not in the top 5 passages):");
    for (const [q, configs] of misses) console.log(`  - ${q}\n      under: ${configs.join(", ")}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
