import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/** Turn a git remote string into https://github.com/<owner>/<repo>, or null. */
export function parseGithubRemote(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!value) return null;
  value = value.replace(/^git\+/, "");
  const https = value.match(
    /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  );
  const ssh = value.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  const sshUrl = value.match(
    /^ssh:\/\/(?:git@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  );
  const match = https ?? ssh ?? sshUrl;
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo || owner === "." || repo === "." || owner.includes(".."))
    return null;
  return `https://github.com/${owner}/${repo}`;
}

function originUrlFromConfig(ini: string): string | null {
  let inOrigin = false;
  for (const line of ini.split(/\r?\n/)) {
    const section = line.match(/^\[(.+)\]\s*$/);
    if (section) {
      inOrigin = /^remote\s+"origin"$/i.test(section[1].trim());
      continue;
    }
    if (!inOrigin) continue;
    const kv = line.match(/^\s*url\s*=\s*(.+?)\s*$/i);
    if (kv) return kv[1].trim();
  }
  return null;
}

async function gitDir(folderPath: string): Promise<string | null> {
  try {
    const marker = path.join(folderPath, ".git");
    const info = await stat(marker);
    if (info.isDirectory()) return marker;
    if (!info.isFile()) return null;
    const text = await readFile(marker, "utf8");
    const line = text.match(/^gitdir:\s*(.+)\s*$/m);
    if (!line) return null;
    return path.resolve(folderPath, line[1].trim());
  } catch {
    return null;
  }
}

async function originAtGitDir(gitdir: string): Promise<string | null> {
  try {
    const local = await readFile(path.join(gitdir, "config"), "utf8");
    const url = originUrlFromConfig(local);
    if (url) return url;
  } catch {
    /* worktrees keep origin on the common git dir */
  }
  try {
    const common = (
      await readFile(path.join(gitdir, "commondir"), "utf8")
    ).trim();
    if (!common) return null;
    const shared = await readFile(
      path.join(path.resolve(gitdir, common), "config"),
      "utf8",
    );
    return originUrlFromConfig(shared);
  } catch {
    return null;
  }
}

/** The checkout holding a folder: its working tree root and git dir. */
async function repoForPath(
  folderPath: string,
): Promise<{ root: string; gitdir: string } | null> {
  try {
    if (!folderPath) return null;
    let current = path.resolve(folderPath);
    const root = path.parse(current).root;
    for (let i = 0; i < 16; i++) {
      const dir = await gitDir(current);
      if (dir) return { root: current, gitdir: dir };
      if (current === root) return null;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
    return null;
  } catch {
    return null;
  }
}

/** Walk toward the filesystem root so a section inside a checkout still finds origin. */
export async function githubUrlForPath(
  folderPath: string,
): Promise<string | null> {
  const repo = await repoForPath(folderPath);
  return repo ? parseGithubRemote(await originAtGitDir(repo.gitdir)) : null;
}

export const gitStatusSchema = z.object({
  /** Branch name, or the short commit when HEAD is detached. */
  branch: z.string().nullable(),
  detached: z.boolean(),
  upstream: z.boolean(),
  ahead: z.number(),
  behind: z.number(),
  /** Changed, staged and untracked files. */
  changes: z.number(),
});
export type GitStatus = z.infer<typeof gitStatusSchema>;

export function parseGitStatus(out: string): GitStatus {
  const status: GitStatus = {
    branch: null,
    detached: false,
    upstream: false,
    ahead: 0,
    behind: 0,
    changes: 0,
  };
  let oid = "";
  for (const line of out.split("\n")) {
    if (!line) continue;
    if (!line.startsWith("# ")) {
      status.changes++;
      continue;
    }
    const [key, ...rest] = line.slice(2).split(" ");
    const value = rest.join(" ");
    if (key === "branch.oid") oid = value;
    else if (key === "branch.head") {
      if (value === "(detached)") status.detached = true;
      else status.branch = value;
    } else if (key === "branch.upstream") status.upstream = true;
    else if (key === "branch.ab") {
      const m = value.match(/^\+(\d+) -(\d+)$/);
      if (m) {
        status.ahead = Number(m[1]);
        status.behind = Number(m[2]);
      }
    }
  }
  if (status.detached && /^[0-9a-f]{7,}$/i.test(oid))
    status.branch = oid.slice(0, 7);
  return status;
}

/**
 * Working tree state as `git status` sees it, without fetching. Optional
 * locks are off so an agent committing in the same checkout never trips
 * over our index refresh.
 */
async function gitStatus(root: string): Promise<GitStatus | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", root, "status", "--porcelain=v2", "--branch"],
      {
        timeout: 5000,
        maxBuffer: 4 << 20,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      },
      (error, stdout) => resolve(error ? null : parseGitStatus(String(stdout))),
    );
  });
}

/** Run `work` over `items` with at most `limit` in flight. */
async function pool<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i]!);
      }
    }),
  );
  return out;
}

// Anonymous GitHub API calls share 60 per hour per IP. Once spent, wait for
// the reset instead of turning every repo's visibility into "unknown".
let rateLimitedUntil = 0;
export function githubRateLimitedUntil(): number {
  return rateLimitedUntil;
}
export function resetGithubRateLimit(): void {
  rateLimitedUntil = 0;
}

/** Fallback without gh: false when the repo is public, otherwise unknown. */
export async function githubPrivateForUrl(
  url: string,
): Promise<boolean | null> {
  const parsed = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!parsed?.[1] || !parsed[2]) return null;
  if (Date.now() < rateLimitedUntil) return null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${parsed[1]}/${parsed[2]}`,
      {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "bb-plugin-project-folders",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (res.status === 200) return false;
    // A 404 is a private repo or a missing one; without a signed-in gh the
    // two cannot be told apart, so leave it unknown.
    if (res.status === 404) return null;
    if (
      (res.status === 403 || res.status === 429) &&
      res.headers.get("x-ratelimit-remaining") === "0"
    ) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      rateLimitedUntil =
        Number.isFinite(reset) && reset > 0
          ? reset * 1000
          : Date.now() + 60 * 60 * 1000;
    }
    return null;
  } catch {
    return null;
  }
}

export async function githubRemotes(input: { paths: string[] }): Promise<{
  remotes: { path: string; url: string | null; git: GitStatus | null }[];
}> {
  const repos = await pool(input.paths, 8, repoForPath);
  const urls = await pool(repos, 8, async (repo) =>
    repo ? parseGithubRemote(await originAtGitDir(repo.gitdir)) : null,
  );
  // Sections inside one checkout share its status: ask git once per repo.
  const roots = [
    ...new Set(
      repos.flatMap((repo, i) => (repo && urls[i] ? [repo.root] : [])),
    ),
  ];
  const statuses = new Map(roots.map((root, i) => [root, i] as const));
  const results = await pool(roots, 4, gitStatus);
  return {
    remotes: input.paths.map((folderPath, i) => {
      const repo = repos[i];
      const url = urls[i] ?? null;
      const index = repo && url ? statuses.get(repo.root) : undefined;
      return {
        path: folderPath,
        url,
        git: index === undefined ? null : (results[index] ?? null),
      };
    }),
  };
}

export const repoVisibilitySchema = z
  .enum(["public", "private", "internal", "missing"])
  .nullable();
export type RepoVisibility = z.infer<typeof repoVisibilitySchema>;

async function ghPath(): Promise<string | null> {
  const dirs = [
    ...(process.env.PATH ?? "").split(path.delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ].filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(
      dir,
      process.platform === "win32" ? "gh.exe" : "gh",
    );
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * Visibility through the machine's signed-in GitHub CLI: no anonymous rate
 * limit, and private repos are told apart from missing ones. "missing" means
 * this account cannot see the repo (deleted, renamed away, or no access);
 * null means gh is absent, signed out or unreachable.
 */
export async function githubVisibility(input: { urls: string[] }): Promise<{
  repos: { url: string; visibility: RepoVisibility }[];
}> {
  const gh = await ghPath();
  const repos = await pool(input.urls, 4, async (url) => {
    const parsed = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
    if (!gh || !parsed?.[1] || !parsed[2])
      return { url, visibility: null as RepoVisibility };
    const visibility = await new Promise<RepoVisibility>((resolve) => {
      execFile(
        gh,
        ["api", `repos/${parsed[1]}/${parsed[2]}`, "--jq", ".visibility"],
        { timeout: 8000, env: { ...process.env, GH_PROMPT_DISABLED: "1" } },
        (error, stdout, stderr) => {
          const value = String(stdout).trim();
          if (
            !error &&
            (value === "public" || value === "private" || value === "internal")
          )
            return resolve(value);
          resolve(/HTTP 404/.test(String(stderr)) ? "missing" : null);
        },
      );
    });
    return { url, visibility };
  });
  return { repos };
}
