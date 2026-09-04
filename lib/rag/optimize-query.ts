import { getOpenRouter, CHAT_MODEL } from "./clients";
import { logApiCall } from "./usage";

const SYSTEM_PROMPT = `You are part of a RAG (Retrieval-Augmented Generation) system. Rewrite the user's message into a short, self-contained search query optimized for retrieving relevant passages from a document knowledge base.

Guidelines:
1. Resolve pronouns and references using the conversation so the query stands alone.
2. Remove filler words; keep key concepts, entities, and technical terms.
3. Keep it concise (usually under 20 words).
4. Preserve the original intent.

Output only the rewritten query, nothing else.`;

export async function getOptimizedQuery(
  query: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  summary?: string | null
): Promise<string> {
  const openrouter = getOpenRouter();

  const recentHistory = history.slice(-4);
  const systemPrompt = summary
    ? `${SYSTEM_PROMPT}\n\nEarlier conversation summary, for context:\n${summary}`
    : SYSTEM_PROMPT;

  const response = await openrouter.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: query },
    ],
    temperature: 0.2,
  });

  logApiCall("openrouter", "optimize_query", {
    tokensUsed: response.usage?.total_tokens,
  });

  return response.choices[0]?.message?.content?.trim() || query;
}
