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
  parseGithubRemote,
} from "./github-remote";

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
    { path: withOrigin, url: "https://github.com/VKirill/demo" },
    { path: bare, url: null },
    { path: missing, url: null },
    { path: worktree, url: "https://github.com/VKirill/demo" },
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

it("treats an anonymous GitHub 404 as private and 200 as public", async () => {
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
    expect(await githubPrivateForUrl("https://github.com/acme/hidden")).toBe(
      true,
    );
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
