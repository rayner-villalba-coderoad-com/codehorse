import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  bestPracticesNode,
  documentationNode,
  performanceNode,
  securityNode,
  synthesizeNode,
} from "./nodes";
import { AgentOutput, ReviewFindings } from "./schema";

/**
 * Graph state. The four agent channels are written by independent nodes (no
 * conflict), so the default last-value reducer is sufficient.
 */
const ReviewStateAnnotation = Annotation.Root({
  diff: Annotation<string>(),
  title: Annotation<string>(),
  description: Annotation<string>(),
  context: Annotation<string[]>(),
  bestPractices: Annotation<AgentOutput>(),
  security: Annotation<AgentOutput>(),
  performance: Annotation<AgentOutput>(),
  documentation: Annotation<AgentOutput>(),
  finalMarkdown: Annotation<string>(),
  findings: Annotation<ReviewFindings>(),
});

/**
 * Fan-out / fan-in topology: the four specialist agents run in parallel from
 * START (same superstep), then `synthesize` joins their results.
 *
 *   START → bestPractices ┐
 *   START → security      ├→ synthesize → END
 *   START → performance   │
 *   START → documentation ┘
 */
const reviewGraph = new StateGraph(ReviewStateAnnotation)
  .addNode("bestPracticesAgent", bestPracticesNode)
  .addNode("securityAgent", securityNode)
  .addNode("performanceAgent", performanceNode)
  .addNode("documentationAgent", documentationNode)
  .addNode("synthesize", synthesizeNode)
  .addEdge(START, "bestPracticesAgent")
  .addEdge(START, "securityAgent")
  .addEdge(START, "performanceAgent")
  .addEdge(START, "documentationAgent")
  .addEdge("bestPracticesAgent", "synthesize")
  .addEdge("securityAgent", "synthesize")
  .addEdge("performanceAgent", "synthesize")
  .addEdge("documentationAgent", "synthesize")
  .addEdge("synthesize", END)
  .compile();

export interface MultiAgentReviewInput {
  diff: string;
  title: string;
  description: string;
  context: string[];
}

export interface MultiAgentReviewResult {
  finalMarkdown: string;
  findings: ReviewFindings;
}

/**
 * Runs the multi-agent review graph and returns the human-facing markdown plus
 * the structured findings to persist.
 */
export async function runMultiAgentReview(
  input: MultiAgentReviewInput
): Promise<MultiAgentReviewResult> {
  const result = await reviewGraph.invoke(input);

  return {
    finalMarkdown: result.finalMarkdown,
    findings: result.findings,
  };
}
