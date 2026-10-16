import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/** Turn a git remote string into https://github.com/<owner>/<repo>, or null. */
export function parseGithubRemote(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!value) return null;
  value = value.replace(/^git\+/, "");
  const https = value.match(
    /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  );
  const ssh = value.match(
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  );
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

/** Walk toward the filesystem root so a section inside a checkout still finds origin. */
export async function githubUrlForPath(folderPath: string): Promise<string | null> {
  try {
    if (!folderPath) return null;
    let current = path.resolve(folderPath);
    const root = path.parse(current).root;
    for (let i = 0; i < 16; i++) {
      const dir = await gitDir(current);
      if (dir) return parseGithubRemote(await originAtGitDir(dir));
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

// Anonymous GitHub API calls share 60 per hour per IP. Once spent, wait for
// the reset instead of turning every repo's visibility into "unknown".
let rateLimitedUntil = 0;
export function githubRateLimitedUntil(): number {
  return rateLimitedUntil;
}
export function resetGithubRateLimit(): void {
  rateLimitedUntil = 0;
}

/** True when GitHub hides the repo from an anonymous request (private or missing). */
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
    if (res.status === 404) return true;
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
  remotes: { path: string; url: string | null }[];
}> {
  const remotes = [];
  for (const folderPath of input.paths) {
    remotes.push({
      path: folderPath,
      url: await githubUrlForPath(folderPath),
    });
  }
  return { remotes };
}
