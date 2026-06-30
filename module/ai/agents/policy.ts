import { AGENT_CATEGORIES, Finding, ReviewFindings, Severity } from "./schema";

/**
 * Severities that block a merge. The testing/requirements agent flags unmet Jira
 * acceptance criteria as "high", and the security agent flags exploitable vulns as
 * "critical"/"high", so both belong in the gate.
 */
const BLOCKING_SEVERITIES: ReadonlySet<Severity> = new Set<Severity>(["critical", "high"]);

export interface MergeBlockDecision {
  /** True when the review found at least one critical/high finding. */
  blocking: boolean;
  criticalCount: number;
  highCount: number;
  /** Critical/high findings across all agents, used to build the comment banner. */
  blockingFindings: Finding[];
}

/**
 * Inspects the multi-agent review findings and decides whether the PR's merge should be
 * gated. Pure and dependency-free (no LLM, no Octokit) so it is trivially testable.
 */
export function evaluateMergeBlock(findings: ReviewFindings): MergeBlockDecision {
  let criticalCount = 0;
  let highCount = 0;
  const blockingFindings: Finding[] = [];

  for (const category of AGENT_CATEGORIES) {
    const output = findings[category];
    if (!output?.findings) continue;

    for (const finding of output.findings) {
      if (!BLOCKING_SEVERITIES.has(finding.severity)) continue;

      if (finding.severity === "critical") criticalCount++;
      else if (finding.severity === "high") highCount++;

      blockingFindings.push(finding);
    }
  }

  return {
    blocking: blockingFindings.length > 0,
    criticalCount,
    highCount,
    blockingFindings,
  };
}

/**
 * Short, human-readable summary for the GitHub commit status `description` (capped well
 * under GitHub's 140-char limit). E.g. "2 critical, 1 high finding(s) require changes".
 */
export function statusDescription(decision: MergeBlockDecision): string {
  if (!decision.blocking) {
    return "No blocking findings — safe to merge";
  }

  const parts: string[] = [];
  if (decision.criticalCount > 0) parts.push(`${decision.criticalCount} critical`);
  if (decision.highCount > 0) parts.push(`${decision.highCount} high`);

  return `${parts.join(", ")} finding(s) require changes`;
}
