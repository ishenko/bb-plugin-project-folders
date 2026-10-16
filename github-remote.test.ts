import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  githubPrivateForUrl,
  githubRateLimitedUntil,
  resetGithubRateLimit,
  githubRemotes,
  githubUrlForPath,
  githubVisibility,
  parseGitStatus,
  parseGithubRemote,
} from "./github-remote";
import { execFileSync } from "node:child_process";
import { chmod } from "node:fs/promises";

const roots: string[] = [];
async function root() {
  const p = await mkdtemp(path.join(tmpdir(), "bb-github-remote-"));
  roots.push(p);
  return p;
}
afterEach(async () => {
  for (const p of roots.splice(0)) await rm(p, { recursive: true, force: true });
});

it("normalizes GitHub https, ssh and .git suffixes", () => {
  expect(parseGithubRemote("https://github.com/VKirill/bb-plugin-project-folders.git")).toBe(
    "https://github.com/VKirill/bb-plugin-project-folders",
  );
  expect(parseGithubRemote("https://github.com/acme/demo")).toBe(
    "https://github.com/acme/demo",
  );
  expect(parseGithubRemote("git@github.com:acme/demo.git")).toBe(
    "https://github.com/acme/demo",
  );
  expect(parseGithubRemote("ssh://git@github.com/acme/demo")).toBe(
    "https://github.com/acme/demo",
  );
  expect(parseGithubRemote("ssh://github.com/acme/demo.git")).toBe(
    "https://github.com/acme/demo",
  );
});

it("rejects non-GitHub remotes and junk", () => {
  expect(parseGithubRemote("https://gitlab.com/acme/demo.git")).toBeNull();
  expect(parseGithubRemote("git@gitlab.com:acme/demo.git")).toBeNull();
  expect(parseGithubRemote("not a remote")).toBeNull();
  expect(parseGithubRemote("")).toBeNull();
  expect(parseGithubRemote(null)).toBeNull();
  expect(parseGithubRemote("https://github.com.evil/acme/demo")).toBeNull();
});

it("reads origin from a folder with a GitHub remote and skips missing git", async () => {
  const withOrigin = await root();
  await mkdir(path.join(withOrigin, ".git"));
  await writeFile(
    path.join(withOrigin, ".git", "config"),
    `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = git@github.com:VKirill/demo.git\n`,
  );
  const bare = await root();
  await mkdir(path.join(bare, ".git"));
  await writeFile(
    path.join(bare, ".git", "config"),
    `[core]\n\trepositoryformatversion = 0\n`,
  );
  const missing = await root();
  const worktree = await root();
  await writeFile(
    path.join(worktree, ".git"),
    `gitdir: ${path.join(withOrigin, ".git")}\n`,
  );
  const { remotes } = await githubRemotes({
    paths: [withOrigin, bare, missing, worktree],
  });
  expect(remotes).toEqual([
    { path: withOrigin, url: "https://github.com/VKirill/demo", git: null },
    { path: bare, url: null, git: null },
    { path: missing, url: null, git: null },
    { path: worktree, url: "https://github.com/VKirill/demo", git: null },
  ]);
  expect(await githubUrlForPath(missing)).toBeNull();
});

it("walks up to the checkout when the section is a nested folder", async () => {
  const repo = await root();
  await mkdir(path.join(repo, ".git"));
  await writeFile(
    path.join(repo, ".git", "config"),
    `[remote "origin"]\n\turl = https://github.com/VKirill/nested.git\n`,
  );
  const nested = path.join(repo, "src", "app");
  await mkdir(nested, { recursive: true });
  expect(await githubUrlForPath(nested)).toBe(
    "https://github.com/VKirill/nested",
  );
});

it("confirms only public anonymously: a 404 may be private or missing", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href.endsWith("/acme/hidden"))
      return new Response("Not Found", { status: 404 });
    if (href.endsWith("/acme/open"))
      return new Response("{}", { status: 200 });
    return new Response("no", { status: 403 });
  }) as typeof fetch;
  try {
    expect(await githubPrivateForUrl("https://github.com/acme/hidden")).toBeNull();
    expect(await githubPrivateForUrl("https://github.com/acme/open")).toBe(
      false,
    );
    expect(await githubPrivateForUrl("https://github.com/acme/other")).toBeNull();
  } finally {
    globalThis.fetch = original;
  }
});

it("stops asking GitHub until the anonymous rate limit resets", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  const reset = Math.floor(Date.now() / 1000) + 600;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("rate limited", {
      status: 403,
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(reset),
      },
    });
  }) as typeof fetch;
  try {
    expect(await githubPrivateForUrl("https://github.com/acme/a")).toBeNull();
    expect(githubRateLimitedUntil()).toBe(reset * 1000);
    expect(await githubPrivateForUrl("https://github.com/acme/b")).toBeNull();
    expect(calls).toBe(1);
  } finally {
    globalThis.fetch = original;
    resetGithubRateLimit();
  }
});

it("parses branch, upstream distance and changes from git status", () => {
  expect(
    parseGitStatus(
      [
        "# branch.oid 0123456789abcdef",
        "# branch.head main",
        "# branch.upstream origin/main",
        "# branch.ab +2 -1",
        "1 .M N... 100644 100644 100644 a b app.tsx",
        "? notes.md",
        "",
      ].join("\n"),
    ),
  ).toEqual({
    branch: "main",
    detached: false,
    upstream: true,
    ahead: 2,
    behind: 1,
    changes: 2,
  });
  expect(
    parseGitStatus("# branch.oid 0123456789abcdef\n# branch.head (detached)\n"),
  ).toEqual({
    branch: "0123456",
    detached: true,
    upstream: false,
    ahead: 0,
    behind: 0,
    changes: 0,
  });
});

it("reports the working tree of a real checkout once per repo", async () => {
  const repo = await root();
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  git("init", "-q", "-b", "work");
  git("remote", "add", "origin", "git@github.com:acme/demo.git");
  await writeFile(path.join(repo, "a.txt"), "a");
  const nested = path.join(repo, "docs");
  await mkdir(nested);
  const { remotes } = await githubRemotes({ paths: [repo, nested] });
  for (const row of remotes) {
    expect(row.url).toBe("https://github.com/acme/demo");
    expect(row.git).toMatchObject({ branch: "work", changes: 1, upstream: false });
  }
});

it("asks the signed-in gh for visibility and tells missing from unknown", async () => {
  const bin = await root();
  const gh = path.join(bin, "gh");
  await writeFile(
    gh,
    [
      "#!/bin/sh",
      'case "$2" in',
      '  repos/acme/secret) echo private ;;',
      '  repos/acme/open) echo public ;;',
      '  repos/acme/gone) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;',
      '  *) echo "error connecting to api.github.com" >&2; exit 1 ;;',
      "esac",
      "",
    ].join("\n"),
  );
  await chmod(gh, 0o755);
  const original = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${original ?? ""}`;
  try {
    const { repos } = await githubVisibility({
      urls: [
        "https://github.com/acme/secret",
        "https://github.com/acme/open",
        "https://github.com/acme/gone",
        "https://github.com/acme/offline",
      ],
    });
    expect(repos.map((r) => r.visibility)).toEqual([
      "private",
      "public",
      "missing",
      null,
    ]);
  } finally {
    process.env.PATH = original;
  }
});
