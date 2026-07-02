import { inngest } from '../client';
import {
  getPullRequestDiff,
  postReviewComment,
  getPullRequestMeta,
  getFileContent,
  createBranch,
  commitFile,
  createPullRequest,
  postPrComment,
  setReviewStatus,
} from '@/module/github/lib/github';
import { retrieveContext } from '@/module/ai/lib/rag';
import { runMultiAgentReview } from '@/module/ai/agents/graph';
import { extractJiraKey, getJiraIssue } from '@/module/jira/lib/jira';
import { collectActionableFindings, generateFixedFile } from '@/module/ai/agents/fixer';
import { evaluateMergeBlock, statusDescription } from '@/module/ai/agents/policy';
import type { Prisma } from '@/lib/generated/prisma/client';
import prisma from '@/lib/db';

// Bounds on the auto-fix step to keep cost and blast radius reasonable.
const MAX_FIX_FILES = 20;
const MAX_FIXABLE_FILE_CHARS = 60000;
// How many files to fetch + LLM-rewrite at once. Bounded so we don't hammer the model's
// rate limit while still avoiding the old one-file-at-a-time sequential latency.
const FIX_CONCURRENCY = 5;

/** Maps items through an async fn with bounded concurrency, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    results.push(...(await Promise.all(chunk.map(fn))));
  }
  return results;
}

export const generateReview = inngest.createFunction(
  { id: "generate-review",
    concurrency: 5,
    triggers: [{event: "pr.review.requested"}],  
  },

  async ({event, step}) => {
    const {owner, repo, prNumber, userId} = event.data;
    const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;

    const {diff, title, description, headRef, headSha, token} = await step.run('fetch-pr-data', async()=> {
      const account = await prisma.account.findFirst({
        where: {
          userId: userId,
          providerId: "github"
        }
      });

      if (!account?.accessToken) {
        throw new Error("No Github access token found");
      }

      const data = await getPullRequestDiff(account.accessToken, owner, repo, prNumber);

      return { ...data, token: account.accessToken}


    });

    // Mark the PR's check as in-progress while the agents run. Best-effort: a missing
    // write scope (403) must not fail the review, so swallow and log.
    await step.run('set-status-pending', async () => {
      try {
        await setReviewStatus(token, owner, repo, headSha, 'pending', 'Reviewing changes…', prUrl);
      } catch (error) {
        console.error('[set-status-pending] failed:', error);
      }
    });

    const context = await step.run('retrieve-context', async()=> {
      const query = `${title}\n${description}`;

      return await retrieveContext(query, `${owner}/${repo}`);
    });

    // Best-effort Jira enrichment: pull the linked ticket (if any) so the agents
    // can review the diff against the ticket's intent and acceptance criteria.
    // Returns null when no key is found or Jira is not configured.
    const ticket = await step.run('resolve-jira-ticket', async () => {
      const key = extractJiraKey([title, headRef, description]);
      if (!key) return null;

      // Prefer the repo owner's saved Jira config; getJiraIssue falls back to
      // the JIRA_* env vars when there is none.
      const config = await prisma.jiraConfig.findUnique({ where: { userId } });
      return await getJiraIssue(key, config);
    });

    // LangGraph orchestrates four specialist agents (best practices, security,
    // performance, documentation) in parallel plus a synthesizer node. With
    // Inngest concurrency 5, this can reach ~20 concurrent Gemini calls — lower
    // the function concurrency if Gemini rate limits become an issue.
    const { finalMarkdown, findings } = await step.run("generate-ai-review", async()=> {
      return await runMultiAgentReview({ title, description, diff, context, ticket });
    });

    // Decide whether critical/high findings should gate the merge.
    const decision = evaluateMergeBlock(findings);

    // Resolve the PR's check: "failure" (with a required-check branch protection rule)
    // disables the merge button; "success" clears it. Best-effort like the pending step.
    await step.run('set-status-final', async () => {
      try {
        await setReviewStatus(
          token,
          owner,
          repo,
          headSha,
          decision.blocking ? 'failure' : 'success',
          statusDescription(decision),
          prUrl
        );
      } catch (error) {
        console.error('[set-status-final] failed:', error);
      }
    });

    await step.run('post-comment', async() => {
      const banner = decision.blocking
        ? `> ⛔ **Merge blocked** — ${statusDescription(decision)} before this PR can be merged.\n\n`
        : '';
      await postReviewComment(token, owner, repo, prNumber, `${banner}${finalMarkdown}`);
    });

    // After the review, an auto-fix agent applies the actionable suggestions on a
    // new branch and opens a PR targeting the original PR's head branch. Best-effort:
    // any failure logs and returns null so the review still gets saved.
    const fix = await step.run('apply-fixes', async (): Promise<{ fixBranch: string; fixPrUrl: string } | null> => {
      const logPrefix = `[apply-fixes] ${owner}/${repo}#${prNumber}`;
      try {
        const targets = collectActionableFindings(findings).slice(0, MAX_FIX_FILES);
        console.log(`${logPrefix}: ${targets.length} actionable target file(s)`);
        if (targets.length === 0) {
          console.log(
            `${logPrefix}: no findings had both a file and a suggestion — skipping auto-fix`
          );
          return null;
        }

        const meta = await getPullRequestMeta(token, owner, repo, prNumber);

        if (meta.isFork) {
          console.log(`${logPrefix}: PR head is a fork — skipping auto-fix`);
          await postPrComment(
            token,
            owner,
            repo,
            prNumber,
            "🤖 Auto-fix is not supported for pull requests opened from a fork yet, so no fix branch was created."
          );
          return null;
        }

        // Phase 1 (concurrent): fetch each file and generate its corrected version. This
        // full-file LLM rewrite is the expensive part — running it in parallel (bounded by
        // FIX_CONCURRENCY) instead of one file at a time is the main speedup. Files that are
        // missing, too large, or unchanged drop out as null.
        const prepared = await mapWithConcurrency(targets, FIX_CONCURRENCY, async (target) => {
          const current = await getFileContent(token, owner, repo, target.file, meta.headRef);
          if (!current) {
            console.warn(`${logPrefix}: ${target.file} not found at ${meta.headRef} — skipping`);
            return null;
          }
          if (current.content.length > MAX_FIXABLE_FILE_CHARS) {
            console.warn(`${logPrefix}: ${target.file} exceeds size limit — skipping`);
            return null;
          }

          const updated = await generateFixedFile({
            path: target.file,
            content: current.content,
            findings: target.items,
          });

          if (!updated || updated === current.content) {
            console.log(`${logPrefix}: ${target.file} unchanged by model — skipping`);
            return null;
          }

          return { file: target.file, content: updated, sha: current.sha };
        });

        const fixes = prepared.filter(
          (f): f is { file: string; content: string; sha: string } => f !== null
        );
        console.log(`${logPrefix}: prepared ${fixes.length} file fix(es)`);
        if (fixes.length === 0) {
          return null;
        }

        // Phase 2 (sequential): create the branch (only now that we have ≥1 fix, so we
        // don't leave empty branches) and commit each file. Commits must be serial — the
        // contents API advances the branch head one commit at a time.
        const fixBranch = `coderoad-ai-reviewer/fix/pr-${prNumber}-${Date.now()}`;
        console.log(`${logPrefix}: creating branch ${fixBranch}`);
        await createBranch(token, owner, repo, fixBranch, meta.headSha);

        for (const f of fixes) {
          await commitFile(token, owner, repo, {
            path: f.file,
            content: f.content,
            message: `fix: apply review suggestions to ${f.file} (PR #${prNumber})`,
            branch: fixBranch,
            sha: f.sha,
          });
        }

        const fixedFiles = fixes.map((f) => f.file);
        const body = [
          `This PR applies automated fixes for review findings on #${prNumber}.`,
          "",
          "Files updated:",
          ...fixedFiles.map((f) => `- \`${f}\``),
          "",
          "---",
          "*Generated by CodeRoad multi-agent review.*",
        ].join("\n");

        const pr = await createPullRequest(token, owner, repo, {
          title: `🤖 Auto-fix: review findings for PR #${prNumber}`,
          head: fixBranch,
          base: meta.headRef,
          body,
        });

        await postPrComment(
          token,
          owner,
          repo,
          prNumber,
          `🤖 I opened a PR with automated fixes for the review findings: ${pr.url}`
        );

        console.log(`${logPrefix}: opened auto-fix PR ${pr.url}`);
        return { fixBranch, fixPrUrl: pr.url };
      } catch (error) {
        console.error(`${logPrefix}: failed:`, error);
        return null;
      }
    });

    await step.run('save-review', async()=> {
      const repository = await prisma.repository.findFirst({
        where: {
          owner,
          name: repo
        }
      });

      if (repository) {
        await prisma.review.create({
          data: {
            repositoryId: repository.id,
            prNumber,
            prTitle: title,
            prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
            review: finalMarkdown,
            findings: findings as unknown as Prisma.InputJsonValue,
            jiraKey: ticket?.key ?? null,
            jiraUrl: ticket?.url ?? null,
            fixBranch: fix?.fixBranch ?? null,
            fixPrUrl: fix?.fixPrUrl ?? null,
            status: "completed",
            blocking: decision.blocking,
            criticalCount: decision.criticalCount,
            highCount: decision.highCount,
          },
        });
      }
    })

    return {success: true}
  }
)