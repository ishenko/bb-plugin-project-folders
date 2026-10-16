---
title: Collapsible project categories
status: complete
updated: 2026-10-16
---

# Project Categories Implementation Plan

**Goal:** Visually group projects under named, collapsible categories without changing files, chats or environments.

**Architecture:** Persist categories and one category assignment per project in the plugin database. Include them in the existing tree snapshot and full backup. Keep category UI in its own module and reuse the tree's saved collapse records.

**Tech Stack:** Existing TypeScript, React, SQLite, Zod, vendored Radix components and Vitest.

**Spec:** Approved in chat: single-level categories, one category per project, remembered collapse state, count of projects, project-menu assignment/creation, category rename/delete, unassigned projects separate. Deleting a category never deletes projects.

## Constraints

- Preserve the current project/section ordering within each category.
- Keep the personal "No project" entry outside categories.
- Use the existing installed fork; no SDK upgrade or new dependencies.
- Older snapshots/backups without categories remain valid.

## Review Focus

- Stale assignments must not hide projects.
- Hidden projects and multiple device roots must not inflate counts.
- Category deletion changes only category tables.
- Failed saves remain visible and keep dialogs open.
- Source-less projects must support assignment too.

## Tasks

- [x] Persistence: add category schemas, migrations, typed CRUD/assignment RPCs, tree state and backup coverage. Test round-trip, reload, reassignment, deletion, bad names/IDs and old backups before implementation.
- [x] Sidebar: add category headers, assignment/create/rename/delete dialogs and project-menu entries. Test collapse persistence, counts, source-less and unassigned projects, stale assignments and failed saves before implementation.
- [x] Verify: run the complete suite, typecheck and plugin build; reload and exercise the workflow in desktop/mobile-sized browser views. Update fork documentation and request advisor review before committing and pushing.

## Verification

| Check | Result |
| --- | --- |
| `npm test -- --maxWorkers=4` | PASS: 330 tests, 36 files |
| `npm run typecheck` | PASS |
| `bb plugin build .` | PASS |
| Advisor review | PASS |
| Live desktop and 375px mobile workflow | PASS: create/assign, collapse/reload, rename and delete |
| Long unbroken dialog name | RED: 1050px content in 470px paragraph; GREEN after wrapping, mobile 341px content in 341px paragraph |

> [!NOTE]
> An unrestricted full run during concurrent build/typecheck hit 10-second UI import-hook timeouts. Two subsequent full runs with four workers passed all 330 tests without changing timeouts. The live test category was removed; the project's original uncategorized state was restored. A pre-migration full backup is in this thread's storage as `before-project-categories.json`.
