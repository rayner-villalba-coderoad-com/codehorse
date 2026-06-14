import { reviewModel } from "./model";
import {
  agentOutputSchema,
  AgentCategory,
  AgentOutput,
  CATEGORY_LABELS,
  Finding,
  ReviewFindings,
  Severity,
} from "./schema";
import {
  BEST_PRACTICES_PROMPT,
  DOCUMENTATION_PROMPT,
  PERFORMANCE_PROMPT,
  SECURITY_PROMPT,
  SYNTHESIZER_PROMPT,
} from "./prompts";

/** Inputs shared by every node, plus the channels filled in as the graph runs. */
export interface ReviewState {
  diff: string;
  title: string;
  description: string;
  context: string[];
  bestPractices: AgentOutput;
  security: AgentOutput;
  performance: AgentOutput;
  documentation: AgentOutput;
  finalMarkdown: string;
  findings: ReviewFindings;
}

/** Diffs can be huge; cap what we send to keep within model limits. */
const MAX_DIFF_CHARS = 30000;

function buildUserPrompt(state: ReviewState): string {
  const context = state.context.length
    ? state.context.join("\n\n")
    : "No additional codebase context retrieved.";

  return `PR Title: ${state.title}
PR Description: ${state.description || "No description provided"}

Relevant context from the codebase:
${context}

Code changes (unified diff):
\`\`\`diff
${state.diff.slice(0, MAX_DIFF_CHARS)}
\`\`\``;
}

/**
 * Builds a specialist agent node. Each node analyzes the diff through its own
 * system prompt and returns structured findings under its state channel.
 */
function createAgentNode(category: AgentCategory, systemPrompt: string) {
  const model = reviewModel.withStructuredOutput(agentOutputSchema, {
    name: "report",
  });

  return async (state: ReviewState): Promise<Partial<ReviewState>> => {
    try {
      const output = (await model.invoke([
        ["system", systemPrompt],
        ["human", buildUserPrompt(state)],
      ])) as AgentOutput;

      return { [category]: output } as Partial<ReviewState>;
    } catch (error) {
      console.error(`[${category}] agent failed:`, error);
      // Degrade gracefully so one failed agent does not abort the whole review.
      return {
        [category]: {
          summary: `The ${CATEGORY_LABELS[category]} agent failed to produce a report.`,
          findings: [],
        },
      } as Partial<ReviewState>;
    }
  };
}

export const bestPracticesNode = createAgentNode("bestPractices", BEST_PRACTICES_PROMPT);
export const securityNode = createAgentNode("security", SECURITY_PROMPT);
export const performanceNode = createAgentNode("performance", PERFORMANCE_PROMPT);
export const documentationNode = createAgentNode("documentation", DOCUMENTATION_PROMPT);

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
  info: "⚪",
};

function renderFinding(finding: Finding): string {
  const lines = [
    `- ${SEVERITY_EMOJI[finding.severity]} **${finding.title}** _(${finding.severity}${
      finding.file ? ` · ${finding.file}` : ""
    })_`,
    `  ${finding.description}`,
  ];
  if (finding.suggestion) {
    lines.push(`  _Suggestion:_ ${finding.suggestion}`);
  }
  return lines.join("\n");
}

function renderSection(label: string, output: AgentOutput): string {
  const body = output.findings.length
    ? output.findings.map(renderFinding).join("\n")
    : "_No issues found._";
  return `### ${label}\n\n${output.summary}\n\n${body}`;
}

/**
 * Join node: runs after all four specialists complete. Produces the executive
 * summary + Mermaid diagram + poem via one LLM call, then assembles the final
 * markdown comment and the structured findings persisted to the database.
 */
export async function synthesizeNode(state: ReviewState): Promise<Partial<ReviewState>> {
  const findings: ReviewFindings = {
    bestPractices: state.bestPractices,
    security: state.security,
    performance: state.performance,
    documentation: state.documentation,
  };

  const agentReports = (Object.keys(findings) as AgentCategory[])
    .map((key) => {
      const output = findings[key];
      const items = output.findings
        .map((f) => `- [${f.severity}] ${f.title}: ${f.description}`)
        .join("\n");
      return `## ${CATEGORY_LABELS[key]}\nSummary: ${output.summary}\nFindings:\n${
        items || "None"
      }`;
    })
    .join("\n\n");

  let overview: string;
  try {
    const response = await reviewModel.invoke([
      ["system", SYNTHESIZER_PROMPT],
      [
        "human",
        `PR Title: ${state.title}
PR Description: ${state.description || "No description provided"}

Specialist agent reports:
${agentReports}`,
      ],
    ]);
    overview =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
  } catch (error) {
    console.error("[synthesize] failed:", error);
    overview = "### Summary\n\nAutomated summary unavailable.";
  }

  const sections = [
    renderSection("Best Practices", findings.bestPractices),
    renderSection("Security", findings.security),
    renderSection("Performance", findings.performance),
    renderSection("Documentation", findings.documentation),
  ].join("\n\n");

  const finalMarkdown = `${overview}\n\n## Detailed Findings\n\n${sections}`;

  return { finalMarkdown, findings };
}
