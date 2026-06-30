import { reviewModel } from "./model";
import {
  AGENT_CATEGORIES,
  Finding,
  ReviewFindings,
  SEVERITIES,
  Severity,
} from "./schema";

export interface FileFixTarget {
  file: string;
  items: Finding[];
}

const severityRank: Record<Severity, number> = SEVERITIES.reduce(
  (acc, sev, i) => ({ ...acc, [sev]: i }),
  {} as Record<Severity, number>
);

/**
 * Collects findings that are actionable as code edits: they must reference a
 * concrete file AND carry a suggestion. Findings are grouped per file and
 * ordered from most to least severe.
 */
export function collectActionableFindings(findings: ReviewFindings): FileFixTarget[] {
  const byFile = new Map<string, Finding[]>();

  for (const category of AGENT_CATEGORIES) {
    const output = findings[category];
    if (!output?.findings) continue;

    for (const finding of output.findings) {
      if (!finding.file || !finding.suggestion) continue;
      const list = byFile.get(finding.file) ?? [];
      list.push(finding);
      byFile.set(finding.file, list);
    }
  }

  return Array.from(byFile.entries()).map(([file, items]) => ({
    file,
    items: items.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]),
  }));
}

/** Removes a leading/trailing markdown code fence the model may wrap around the file. */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return text;

  return trimmed
    .replace(/^```[^\n]*\n/, "") // opening fence (with optional language)
    .replace(/\n```$/, "") // closing fence
    .trim();
}

const FIXER_PROMPT = `You are a senior software engineer applying code review suggestions to a single file.
Apply ONLY the listed suggestions. Make the minimal changes needed to address them and
preserve all unrelated code, comments, formatting, and style. Do not refactor anything
that was not flagged. Return the COMPLETE updated file content and nothing else — no
explanations, no commentary, and no markdown code fences.`;

/**
 * Rewrites a file applying the given review suggestions. Returns the full corrected
 * file content.
 */
export async function generateFixedFile(input: {
  path: string;
  content: string;
  findings: Finding[];
}): Promise<string> {
  const suggestions = input.findings
    .map(
      (f, i) =>
        `${i + 1}. [${f.severity}] ${f.title}\n   Issue: ${f.description}\n   Suggestion: ${f.suggestion}`
    )
    .join("\n");

  const response = await reviewModel.invoke([
    ["system", FIXER_PROMPT],
    [
      "human",
      `File: ${input.path}

Review suggestions to apply:
${suggestions}

Current file content:
${input.content}`,
    ],
  ]);

  const text =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  return stripCodeFences(text);
}
