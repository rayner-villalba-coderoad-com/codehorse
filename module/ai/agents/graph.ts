import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  bestPracticesNode,
  documentationNode,
  performanceNode,
  securityNode,
  testingNode,
  synthesizeNode,
} from "./nodes";
import { AgentOutput, ReviewFindings } from "./schema";
import type { JiraTicket } from "@/module/jira/lib/jira";

/**
 * Graph state. The five agent channels are written by independent nodes (no
 * conflict), so the default last-value reducer is sufficient.
 */
const ReviewStateAnnotation = Annotation.Root({
  diff: Annotation<string>(),
  title: Annotation<string>(),
  description: Annotation<string>(),
  context: Annotation<string[]>(),
  ticket: Annotation<JiraTicket | null>(),
  bestPractices: Annotation<AgentOutput>(),
  security: Annotation<AgentOutput>(),
  performance: Annotation<AgentOutput>(),
  documentation: Annotation<AgentOutput>(),
  testing: Annotation<AgentOutput>(),
  finalMarkdown: Annotation<string>(),
  findings: Annotation<ReviewFindings>(),
});

/**
 * Fan-out / fan-in topology: the four specialist agents run in parallel from
 * START (same superstep), then `synthesize` joins their results.
 *
 *   START → bestPractices ┐
 *   START → security      │
 *   START → performance   ├→ synthesize → END
 *   START → documentation │
 *   START → testing       ┘
 */
const reviewGraph = new StateGraph(ReviewStateAnnotation)
  .addNode("bestPracticesAgent", bestPracticesNode)
  .addNode("securityAgent", securityNode)
  .addNode("performanceAgent", performanceNode)
  .addNode("documentationAgent", documentationNode)
  .addNode("testingAgent", testingNode)
  .addNode("synthesize", synthesizeNode)
  .addEdge(START, "bestPracticesAgent")
  .addEdge(START, "securityAgent")
  .addEdge(START, "performanceAgent")
  .addEdge(START, "documentationAgent")
  .addEdge(START, "testingAgent")
  .addEdge("bestPracticesAgent", "synthesize")
  .addEdge("securityAgent", "synthesize")
  .addEdge("performanceAgent", "synthesize")
  .addEdge("documentationAgent", "synthesize")
  .addEdge("testingAgent", "synthesize")
  .addEdge("synthesize", END)
  .compile();

export interface MultiAgentReviewInput {
  diff: string;
  title: string;
  description: string;
  context: string[];
  ticket: JiraTicket | null;
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
