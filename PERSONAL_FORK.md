---
title: Personal Projects & Sections fork
status: active
owner: Igor
updated: 2026-10-16
tags: [bb, plugin, fork]
---

# Personal Projects & Sections fork

> [!IMPORTANT]
> BB uses the persistent local checkout `~/.bb/local-plugins/project-folders` with the original plugin ID `project-folders`. This preserves its existing database, tree, settings and integrations. It has no automatic upstream update channel. Do not edit BB's managed plugin cache or uninstall this fork for routine updates.

## Source and update policy

- GitHub fork: `ishenko/bb-plugin-project-folders` (already existed; reused rather than replacing existing branches).
- Personal branch: `personal/igor-20261009-export-fix`.
- Base: upstream v0.6.30, commit `b4bb6d0a064a0946e2f1da9235aa6cc4d0c47ef4`.
- Personal version: `0.6.30-igor.2`.
- `origin` is the personal fork; `upstream` is `VKirill/bb-plugin-project-folders`.
- Existing local thread-status icons and styles are retained in this branch.
- Upstream changes are integrated deliberately in this checkout, tested, built and reloaded; never automatically substituted for personal changes.

## Changes

| Area | Behaviour |
| --- | --- |
| Automatic history export | Personal chats, unregistered worktrees and retired/unregistered workspaces settle without persisting an out-of-scope export error or retrying forever. |
| Explicit manual export | An unregistered folder still produces an actionable error; it is not reported as a successful export. |
| Existing diagnostic rows | At plugin startup, remove only the exact legacy unregistered-folder error with a null export path. Preserve successful export records, other errors and all project/chat state. |
| Chat labels | Settings → «Метки чатов» defines labels (name + color). Chat menu ⋯ → «Метка» sets one label per chat, shown as a compact chip after the title. Tables `thread_tags` / `thread_tag_assignments`, included in the full backup. |
| BB SDK compatibility | Pin SDK 0.6.15; use current composer hooks and methods. Preserve provider-defined service tier strings. |
| Tree spacing | One 2px gap between projects whether collapsed, empty or open; 32px headings. Empty projects and sections show no disclosure chevron (a spacer keeps names aligned). |
| GitHub mark | Round, muted GitHub logo in the standard 28×28 icon area. Tooltip shows `owner/repo · Private/Public/Internal` (or «Нет доступа») and a second line with branch, ↑ahead ↓behind and the number of changed files. An amber dot marks uncommitted changes. Visibility comes from the machine's signed-in `gh` (the anonymous API only confirms public), persisted in `github_repos` (transient, not in backups), re-checked daily, hourly for missing repos. Git status is `git status --porcelain=v2 --branch` with `GIT_OPTIONAL_LOCKS=0`, no fetch, re-read at most every 90 s while the tree is in use. |
| Chat tooltip | Hovering a chat shows its status, total tokens and approximate cost (Hub plugin's `thread_usage`; no line without Hub) and a short gist. The tooltip opens below the row, is capped at the trigger width, 260px and available viewport space, and wraps status/usage text instead of overflowing; the gist is capped at three lines. Gists are written by a cheap OmniRoute model set in Settings → «Подсказка чата» (default `glm/glm-5.3-flash`, key from Env Catalog or the `codex-omniroute` keychain item), only on hover, cached in `thread_summaries` and rewritten only after new messages; running chats are not summarized. |
| New chat toolbar | Framed «Новый чат» button (⌘N hint) with thread search pinned right, sticky above the tree. Search uses BB's navigation action when available, otherwise BB's Mod+K binding. BB's own «Новый чат» row is hidden through `sidebar.visiblePluginPanels` (re-show it in Settings → Appearance → Navigation). |
| Performance | `list` reads folders and paths once per request (≈50 ms → ≈7 ms with 200 environments); chat rows are memoized with stable callbacks (tree re-render ≈2.5× faster); refreshes are debounced, deduplicated and repeated on returning to the window. |
| Code layout | `app.tsx` only registers slots. Tree: `tree.tsx`, `use-tree.ts`, `tree-model.ts`, `tree-dialogs.tsx`, `tree-toolbar.tsx`; rows: `thread-row.tsx`, `thread-tip.tsx`, `folder-heading.tsx`; management page: `panel.tsx`; server helpers: `thread-insight.ts`, `folder-size.ts`, `github-remote.ts`. |
| Folder tooltip | Hovering a project or section name shows its path and, read lazily on that machine with `du`, its disk size (host RPC `folder_size`, only for folders in the tree, cached 10 min). |

The dependency lockfile also advances `source-map-js` to its compatible patched release; `npm audit` reports zero vulnerabilities at verification time.

Canonical conversation history stays in BB. The plugin export is an additional filesystem copy, not the canonical record.

## Validation and local updates

```sh
cd ~/.bb/local-plugins/project-folders
npm ci
npm run typecheck
npm test
bb plugin build .
bb plugin reload project-folders
bb plugin source project-folders --json
bb plugin list --json
```

Check the project tree and the export diagnostics in plugin settings in the live BB interface. An unbound manual `sync` should fail clearly without repopulating the settings error list. Real file-write failures must still be visible.

> [!WARNING]
> Do not clear the whole exports table or suppress all export errors. Do not move chats or register arbitrary working folders just to silence this diagnostic.

## Rollback

Before source replacement, a SQLite online backup and the plugin's durable-state export are saved outside this checkout, in the setup thread's artifact directory. Local source changes can be rolled back with Git and then rebuilt/reloaded without uninstalling the plugin. Uninstalling deletes declarative settings, secrets and schedules; back them up before any intentional switch back to a managed source.
