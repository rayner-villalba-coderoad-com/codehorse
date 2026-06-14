import {Octokit} from "octokit";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import { headers } from "next/headers";

// Getting the github access token from the database and return it
export const getGithubToken = async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const account = await prisma.account.findFirst({
    where: { 
      userId: session.user.id,
      providerId: "github",
    }
  });

  if (!account?.accessToken) {
    throw new Error("GitHub access token not found");
  }

  return account.accessToken;
}

interface contributionData {
  user: {
    contributionsCollection: {
      contributionCalendar: {
        totalContributions: number;
        weeks: {
          contributionDays: {
            date: string | Date;
            contributionCount: number;
            color: string;
          }[];
        }[];
      };
    };
  };
}

export async function fetchUserContribution(token: string, username: string) {
  const octokit = new Octokit({ auth: token });

  const query = `
    query($username: String!) {
      user(login: $username) { 
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
                color
              }
            }
          }        
        }
      }
    }
  `;

  try {
    const response: contributionData = await octokit.graphql(query, {
      username: username
    });
    return response.user.contributionsCollection.contributionCalendar;
  } catch (error) {
    console.error("Error fetching user contributions:", error);
    throw error;
  }
}

export const getRepositories = async (page: number = 1, perPage: number = 10) => {
  const token = await getGithubToken();
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    sort: "updated",
    direction: "desc",
    visibility: "all",
    per_page: perPage,
    page: page,
  });
  return data;
}

export const createWebhook = async(owner: string, repo:string) => {
  const token = await getGithubToken();
  const octokit = new Octokit({ auth: token });

  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_BASE_URL}/api/webhooks/github`;

  const {data:hooks} = await octokit.rest.repos.listWebhooks({
    owner,
    repo
  });

  const existingHook = hooks.find(hook=> hook.config.url === webhookUrl);

  if (existingHook) {
    return existingHook;
  }

  //Create webhook
  const { data } = await octokit.rest.repos.createWebhook({
    owner,
    repo,
    config: {
      url: webhookUrl,
      content_type: 'json'
    },
    events:['pull_request']
  });

  return data; 
}

export const deleteWebhook = async(owner: string, repo: string) => {
  const token = await getGithubToken();
  const octokit = new Octokit({auth: token}); 
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_BASE_URL}/api/webhooks/github`;

  try {
    const {data:hooks} = await octokit.rest.repos.listWebhooks({
      owner,
      repo
    })

    const hookToDelete = hooks.find(hook => hook.config.url === webhookUrl);

    if (hookToDelete) {
      await octokit.rest.repos.deleteWebhook({
        owner,
        repo,
        hook_id: hookToDelete.id
      });

      return true
    }

    return false
  } catch (error) {
    console.error("Error deleting webhook: ", error);
    return false;
  }
}

export async function getRepoFileContents(
  token: string, 
  owner: string, 
  repo: string,
  path: string = ""
): Promise<{path: string, content: string}[]> {
  const octokit = new Octokit({auth: token});

  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path
  });

  if (!Array.isArray(data)) {
    //It's a file 
    if (data.type === 'file' && data.content) {
      return [{
        path: data.path,
        content: Buffer.from(data.content, "base64").toString("utf-8")
      }];
    }

    return [];
  }

  let files: {path: string, content: string} [] = []

  for(const item of data) {
    if (item.type === 'file') {
      const {data: fileData} = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: item.path
      });

      if (!Array.isArray(fileData) && fileData.type === 'file' && fileData.content) {
        //Filter out non-code files if needed (images, etc.)
        //For now, let's include everything that looks like text
        if (!item.path.match(/\.(png|jpg|jpeg|gif|svg|ico|pdf|zip|tar|gz)$/i)) {
          files.push({
            path: item.path,
            content: Buffer.from(fileData.content, "base64").toString("utf-8")
          });
        }
      }
    

    } else if (item.type === 'dir') {
      const subFiles = await getRepoFileContents(token, owner, repo, item.path)
      
      files = files.concat(subFiles)
    }
  }

  return files;
}

export async function getPullRequestDiff(
  token: string,
  owner: string,
  repo: string,
  prNumber: number
) {
  const octokit = new Octokit({auth: token});
  const {data: pr} = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber
  });

  const {data:diff} = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: {
      format: 'diff'
    }
  });

  return {
    diff: diff as unknown as string,
    title: pr.title,
    description: pr.body || ""
  };
}

export async function postReviewComment(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  review: string
) {
  const octokit = new Octokit({auth: token});

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: `## 🤖 CodeRoad AI Code Reviewer\n\n${review}\n\n---\n*Powered by CodeRoad*`,
  })
}

// Posts a plain comment on a PR/issue (no review header wrapper).
export async function postPrComment(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
) {
  const octokit = new Octokit({ auth: token });

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}

// Metadata about a PR's head/base branches, used by the auto-fix flow.
export async function getPullRequestMeta(
  token: string,
  owner: string,
  repo: string,
  prNumber: number
) {
  const octokit = new Octokit({ auth: token });
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  return {
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    baseRef: pr.base.ref,
    // The auto-fix flow only supports PRs whose head branch lives in the same repo.
    isFork: pr.head.repo?.fork ?? pr.head.repo?.full_name !== `${owner}/${repo}`,
  };
}

// Reads a single file at a given ref. Returns null if it does not exist or is not a file.
export async function getFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<{ content: string; sha: string } | null> {
  const octokit = new Octokit({ auth: token });

  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });

    if (Array.isArray(data) || data.type !== "file" || !data.content) {
      return null;
    }

    return {
      content: Buffer.from(data.content, "base64").toString("utf-8"),
      sha: data.sha,
    };
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 404) {
      return null;
    }
    throw error;
  }
}

// Creates a branch from a commit SHA. Tolerates an already-existing ref (retry-safe).
export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  fromSha: string
) {
  const octokit = new Octokit({ auth: token });

  try {
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: fromSha,
    });
  } catch (error: unknown) {
    // 422 = "Reference already exists" — fine, we'll commit onto the existing branch.
    if (typeof error === "object" && error !== null && "status" in error && error.status === 422) {
      return;
    }
    throw error;
  }
}

// Creates or updates a file on a branch. `sha` is required when updating an existing file.
export async function commitFile(
  token: string,
  owner: string,
  repo: string,
  params: { path: string; content: string; message: string; branch: string; sha?: string }
) {
  const octokit = new Octokit({ auth: token });

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: params.path,
    message: params.message,
    content: Buffer.from(params.content, "utf-8").toString("base64"),
    branch: params.branch,
    sha: params.sha,
  });
}

// Opens a pull request and returns its URL and number.
export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  params: { title: string; head: string; base: string; body: string }
): Promise<{ url: string; number: number }> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.rest.pulls.create({
    owner,
    repo,
    title: params.title,
    head: params.head,
    base: params.base,
    body: params.body,
  });

  return { url: data.html_url, number: data.number };
}


