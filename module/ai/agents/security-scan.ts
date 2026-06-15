import { reviewModel } from "./model";
import {
  agentOutputSchema,
  AgentOutput,
  Finding,
  SEVERITIES,
  Severity,
} from "./schema";

/**
 * Whole-repository security audit agent. Unlike the PR review agents (which only
 * look at a diff), this scans every code file of a repo in batches and aggregates
 * the findings into a single vulnerability report.
 */

const SECURITY_SCAN_PROMPT = `You are an application security engineer auditing an ENTIRE codebase for vulnerabilities.
You will receive a batch of source files (path + full content). Review every file in the batch.

Look for: injection (SQL, command, XSS), hardcoded secrets or credentials, broken
authentication/authorization, missing input validation, insecure handling or exposure
of sensitive data, unsafe deserialization, SSRF, insecure cryptography, path traversal,
and risky or vulnerable dependencies.

Rules:
- Base every finding on the actual code shown — do not invent issues.
- Always set the "file" field to the path of the file the finding is in.
- When there is a concrete, safe code change that fixes the issue, put it in "suggestion".
- Use "critical"/"high" severities only for exploitable vulnerabilities.
- Order findings from most to least severe. If a batch has nothing worth reporting,
  return an empty findings array and say so in the summary.`;

// Per-file and per-batch limits keep each LLM call within context and bound cost.
const MAX_FILE_CHARS = 12000;
const MAX_BATCH_CHARS = 60000;
const MAX_FILES = 400;

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
  info: "⚪",
};

const severityRank: Record<Severity, number> = SEVERITIES.reduce(
  (acc, sev, i) => ({ ...acc, [sev]: i }),
  {} as Record<Severity, number>
);

export interface SecurityScanResult {
  findings: Finding[];
  report: string;
  counts: { critical: number; high: number; medium: number; low: number; info: number; total: number };
}

export interface FileFixTarget {
  file: string;
  items: Finding[];
}

interface ScanFile {
  path: string;
  content: string;
}

/** Packs files into batches whose combined (truncated) content fits the context budget. */
function buildBatches(files: ScanFile[]): { batches: ScanFile[][]; skipped: number } {
  const considered = files.slice(0, MAX_FILES);
  const skipped = files.length - considered.length;

  const batches: ScanFile[][] = [];
  let current: ScanFile[] = [];
  let currentChars = 0;

  for (const file of considered) {
    const content = file.content.slice(0, MAX_FILE_CHARS);
    const size = content.length + file.path.length;

    if (currentChars + size > MAX_BATCH_CHARS && current.length > 0) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }

    current.push({ path: file.path, content });
    currentChars += size;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return { batches, skipped };
}

function buildBatchPrompt(batch: ScanFile[]): string {
  return batch
    .map((f) => `File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");
}

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

function buildReport(
  findings: Finding[],
  counts: SecurityScanResult["counts"],
  skipped: number
): string {
  const header = [
    "## 🔒 Security Scan Report",
    "",
    `**${counts.total}** findings — ` +
      `🔴 ${counts.critical} critical · 🟠 ${counts.high} high · ` +
      `🟡 ${counts.medium} medium · 🔵 ${counts.low} low · ⚪ ${counts.info} info`,
  ];

  if (skipped > 0) {
    header.push("", `_Note: ${skipped} file(s) were skipped to stay within scan limits._`);
  }

  if (findings.length === 0) {
    header.push("", "No security issues found. ✅");
    return header.join("\n");
  }

  const body = findings.map(renderFinding).join("\n");
  return [...header, "", "### Findings", "", body].join("\n");
}

/**
 * Scans a whole repository for security vulnerabilities, batch by batch, and
 * returns the aggregated findings plus a markdown report.
 */
export async function runSecurityScan(input: {
  repoId: string;
  files: ScanFile[];
}): Promise<SecurityScanResult> {
  const model = reviewModel.withStructuredOutput(agentOutputSchema, {
    name: "report",
  });

  const { batches, skipped } = buildBatches(input.files);
  const findings: Finding[] = [];

  for (const batch of batches) {
    try {
      const output = (await model.invoke([
        ["system", SECURITY_SCAN_PROMPT],
        ["human", buildBatchPrompt(batch)],
      ])) as AgentOutput;

      findings.push(...output.findings);
    } catch (error) {
      // Degrade gracefully: a failed batch should not abort the whole scan.
      console.error(`[security-scan] batch failed for ${input.repoId}:`, error);
    }
  }

  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  const counts = {
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
    info: findings.filter((f) => f.severity === "info").length,
    total: findings.length,
  };

  return { findings, counts, report: buildReport(findings, counts, skipped) };
}

/**
 * Filters scan findings down to the critical ones that are actionable as code
 * edits (they reference a file AND carry a suggestion), grouped per file.
 */
export function collectCriticalFixTargets(findings: Finding[]): FileFixTarget[] {
  const byFile = new Map<string, Finding[]>();

  for (const finding of findings) {
    if (finding.severity !== "critical" || !finding.file || !finding.suggestion) continue;
    const list = byFile.get(finding.file) ?? [];
    list.push(finding);
    byFile.set(finding.file, list);
  }

  return Array.from(byFile.entries()).map(([file, items]) => ({ file, items }));
}
