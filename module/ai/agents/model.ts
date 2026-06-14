import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

/**
 * Shared chat model for every review agent. Uses the same Gemini model and
 * API key (`GOOGLE_GENERATIVE_AI_API_KEY`) as the rest of the app.
 */
export const reviewModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  temperature: 0.2,
});
