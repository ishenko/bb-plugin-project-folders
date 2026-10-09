---
title: Personal Projects & Sections fork
status: active
owner: Igor
updated: 2026-10-09
tags: [bb, plugin, fork]
---

# Personal Projects & Sections fork

> [!IMPORTANT]
> BB uses the persistent local checkout `~/.bb/local-plugins/project-folders` with the original plugin ID `project-folders`. This preserves its existing database, tree, settings and integrations. It has no automatic upstream update channel. Do not edit BB's managed plugin cache or uninstall this fork for routine updates.

## Source and update policy

- GitHub fork: `ishenko/bb-plugin-project-folders` (already existed; reused rather than replacing existing branches).
- Personal branch: `personal/igor-20261009-export-fix`.
- Base: upstream v0.6.30, commit `b4bb6d0a064a0946e2f1da9235aa6cc4d0c47ef4`.
- Personal version: `0.6.30-igor.1`.
- `origin` is the personal fork; `upstream` is `VKirill/bb-plugin-project-folders`.
- Existing local thread-status icons and styles are retained in this branch.
- Upstream changes are integrated deliberately in this checkout, tested, built and reloaded; never automatically substituted for personal changes.

## Changes

| Area | Behaviour |
| --- | --- |
| Automatic history export | Personal chats, unregistered worktrees and retired/unregistered workspaces settle without persisting an out-of-scope export error or retrying forever. |
| Explicit manual export | An unregistered folder still produces an actionable error; it is not reported as a successful export. |
| Existing diagnostic rows | At plugin startup, remove only the exact legacy unregistered-folder error with a null export path. Preserve successful export records, other errors and all project/chat state. |
| BB SDK compatibility | Pin SDK 0.6.15; use current composer hooks and methods. Preserve provider-defined service tier strings. |

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
