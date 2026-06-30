import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

/**
 * Provider for the review/fixer chat model. Selected at startup via the
 * `AI_PROVIDER` env var (`gemini` | `anthropic`); defaults to `gemini` to keep
 * the existing behavior. Embeddings/RAG stay on Gemini regardless — only the
 * chat model used by the review agents is swappable here.
 */
type Provider = "gemini" | "anthropic";

function createReviewModel(): BaseChatModel {
  const provider = (process.env.AI_PROVIDER ?? "gemini") as Provider;

  if (provider === "anthropic") {
    return new ChatAnthropic({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      apiKey: process.env.ANTHROPIC_API_KEY,
      // ChatAnthropic requires max_tokens and defaults it low; bump it so the
      // synthesizer's review (summary + diagram + sections) is not truncated.
      maxTokens: 8192,
      // temperature is intentionally omitted: Sonnet 4.6 accepts it, but Opus
      // 4.7+/Fable 5 reject it with a 400, so leaving it off keeps this factory
      // safe if ANTHROPIC_MODEL is later pointed at an Opus model.
    });
  }

  // Default: Gemini — same model and API key (`GOOGLE_GENERATIVE_AI_API_KEY`)
  // as the rest of the app.
  return new ChatGoogleGenerativeAI({
    model: "gemini-3.5-flash",
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    temperature: 0.2,
  });
}

/** Shared chat model for every review agent (singleton). */
export const reviewModel = createReviewModel();
