import { z } from "zod";

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

export const findingSchema = z.object({
  severity: z
    .enum(SEVERITIES)
    .describe("Impact level of the finding. Use 'info' for non-blocking observations."),
  title: z.string().describe("Short, specific title for the finding."),
  description: z
    .string()
    .describe("What the issue is and why it matters, referencing the changed code."),
  file: z
    .string()
    .optional()
    .describe("Path of the file the finding applies to, if identifiable from the diff."),
  suggestion: z
    .string()
    .optional()
    .describe("Concrete suggestion or code change to address the finding."),
});

export const agentOutputSchema = z.object({
  summary: z
    .string()
    .describe("One or two sentences summarizing this agent's overall assessment."),
  findings: z
    .array(findingSchema)
    .describe("List of findings. Return an empty array if there is nothing to report."),
});

export const reviewFindingsSchema = z.object({
  bestPractices: agentOutputSchema,
  security: agentOutputSchema,
  performance: agentOutputSchema,
  documentation: agentOutputSchema,
  testing: agentOutputSchema,
});

export type Severity = (typeof SEVERITIES)[number];
export type Finding = z.infer<typeof findingSchema>;
export type AgentOutput = z.infer<typeof agentOutputSchema>;
export type ReviewFindings = z.infer<typeof reviewFindingsSchema>;

/** Keys of the four specialist agents, used as state channels and DB categories. */
export const AGENT_CATEGORIES = [
  "bestPractices",
  "security",
  "performance",
  "documentation",
  "testing",
] as const;

export type AgentCategory = (typeof AGENT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<AgentCategory, string> = {
  bestPractices: "Best Practices",
  security: "Security",
  performance: "Performance",
  documentation: "Documentation",
  testing: "Testing & Requirements",
};
