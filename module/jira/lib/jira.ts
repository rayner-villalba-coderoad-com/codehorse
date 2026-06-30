/**
 * Jira Cloud integration (read-only). Best-effort by design: when the
 * JIRA_* env vars are missing or a request fails, every function degrades to a
 * null/empty result so the code-review pipeline keeps working without Jira.
 *
 * Auth mirrors the GITHUB_PERSONAL_ACCESS_TOKEN pattern: a single shared
 * service account via env vars, called with native fetch (no extra dependency).
 */

export interface JiraTicket {
  key: string;
  url: string;
  summary: string;
  description: string;
  status: string;
  issueType: string;
  priority: string;
  labels: string[];
}

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

/**
 * Resolves the Jira credentials to use: prefers explicitly provided ones (e.g.
 * a user's saved config), otherwise falls back to the JIRA_* env vars. Returns
 * null when neither source is complete, which disables Jira enrichment.
 */
function resolveCredentials(creds?: JiraCredentials | null): JiraCredentials | null {
  if (creds?.baseUrl && creds.email && creds.apiToken) {
    return creds;
  }

  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (baseUrl && email && apiToken) {
    return { baseUrl, email, apiToken };
  }

  return null;
}

/** Strips trailing slashes and builds the Basic auth header value for a request. */
function jiraAuthHeaders(creds: JiraCredentials): { root: string; headers: HeadersInit } {
  const root = creds.baseUrl.replace(/\/+$/, "");
  const auth = Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64");
  return {
    root,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  };
}

// Matches keys like PROJ-123 or AB1-42. Bounded so it does not greedily match
// unrelated all-caps tokens; word boundaries avoid partial matches inside words.
const JIRA_KEY_REGEX = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/;

/**
 * Returns the first Jira issue key found across the provided strings, scanned
 * in order (typically PR title, then branch name, then PR body). Null if none.
 */
export function extractJiraKey(sources: Array<string | null | undefined>): string | null {
  for (const source of sources) {
    if (!source) continue;
    const match = source.match(JIRA_KEY_REGEX);
    if (match) return match[0];
  }
  return null;
}

/** Minimal shape of an Atlassian Document Format node we care about. */
interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

// Block-level ADF node types that should produce a line break when flattened.
const ADF_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "listItem",
  "blockquote",
  "codeBlock",
  "rule",
]);

/**
 * Flattens a v3 Atlassian Document Format `description` object into plain text:
 * concatenates `text` leaf nodes and inserts newlines after block-level nodes.
 * Returns "" for null/empty/non-ADF input.
 */
function adfToPlainText(node: unknown): string {
  if (!node || typeof node !== "object") return "";

  const adf = node as AdfNode;
  let out = "";

  if (adf.text) {
    out += adf.text;
  }

  if (Array.isArray(adf.content)) {
    for (const child of adf.content) {
      out += adfToPlainText(child);
    }
  }

  if (adf.type && ADF_BLOCK_TYPES.has(adf.type)) {
    out += "\n";
  }

  return out;
}

interface JiraIssueResponse {
  key: string;
  fields?: {
    summary?: string;
    description?: unknown; // ADF object (v3) or null
    status?: { name?: string };
    issuetype?: { name?: string };
    priority?: { name?: string };
    labels?: string[];
  };
}

/**
 * Fetches a Jira issue by key from Jira Cloud. Credentials default to the
 * provided per-user config and fall back to the JIRA_* env vars. Returns null
 * when Jira is not configured or the request fails — callers treat null as
 * "no ticket".
 */
export async function getJiraIssue(
  key: string,
  credentials?: JiraCredentials | null
): Promise<JiraTicket | null> {
  const creds = resolveCredentials(credentials);

  if (!creds) {
    return null;
  }

  const { root, headers } = jiraAuthHeaders(creds);
  const fields = "summary,description,status,issuetype,priority,labels";
  const url = `${root}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}`;

  try {
    const response = await fetch(url, { headers });

    if (!response.ok) {
      console.error(`[jira] issue ${key} fetch failed: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as JiraIssueResponse;
    const fieldsData = data.fields ?? {};

    return {
      key: data.key,
      url: `${root}/browse/${data.key}`,
      summary: fieldsData.summary ?? "",
      description: adfToPlainText(fieldsData.description).trim(),
      status: fieldsData.status?.name ?? "Unknown",
      issueType: fieldsData.issuetype?.name ?? "Unknown",
      priority: fieldsData.priority?.name ?? "Unknown",
      labels: fieldsData.labels ?? [],
    };
  } catch (error) {
    console.error(`[jira] issue ${key} fetch error:`, error);
    return null;
  }
}

/**
 * Validates a set of Jira credentials by calling the `/myself` endpoint. Used by
 * the settings "Test connection" action. Does not fall back to env vars — it
 * tests exactly the credentials provided.
 */
export async function verifyJiraCredentials(
  creds: JiraCredentials
): Promise<{ ok: boolean; error?: string }> {
  if (!creds.baseUrl || !creds.email || !creds.apiToken) {
    return { ok: false, error: "Base URL, email, and API token are all required." };
  }

  const { root, headers } = jiraAuthHeaders(creds);

  try {
    const response = await fetch(`${root}/rest/api/3/myself`, { headers });

    if (response.ok) {
      return { ok: true };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "Authentication failed — check the email and API token." };
    }

    return { ok: false, error: `Jira responded with status ${response.status}.` };
  } catch {
    return { ok: false, error: "Could not reach Jira — check the base URL." };
  }
}

/**
 * Renders a Jira ticket as a prompt block for the review agents. Returns a
 * fallback string when no ticket is linked so prompts stay well-formed.
 */
export function formatTicketForPrompt(ticket: JiraTicket | null): string {
  if (!ticket) {
    return "No linked Jira ticket found.";
  }

  const labels = ticket.labels.length ? ticket.labels.join(", ") : "none";

  return `Linked Jira ticket: ${ticket.key} — ${ticket.summary}
Status: ${ticket.status} · Type: ${ticket.issueType} · Priority: ${ticket.priority} · Labels: ${labels}
Description / acceptance criteria:
${ticket.description || "No description provided in the ticket."}`;
}
