# Projects & Sections

Projects & Sections is a BB plugin that organizes project chats into sections backed by folders on connected devices. It also provides per-place rules and chat defaults, archives, history exports, appearance controls and optional session-context filtering.

## Install

```sh
bb plugin install https://github.com/VKirill/bb-plugin-project-folders.git --yes
```

In BB, choose Projects & Sections as the sidebar thread list if it is not selected automatically. Open the management page to create a project.

## Documentation

- [Overview](docs/overview.md) — purpose, stack and starting points.
- [Architecture](docs/architecture.md) — runtime parts and BB integration.
- [Features](docs/features/project-tree.md) — user-facing capabilities.
- [Chat list](docs/features/chat-list.md) · [Starting chats in sections](docs/features/section-chats.md) · [Agent rules](docs/features/agent-rules.md)
- [Execution defaults](docs/features/execution-settings.md) · [Session context](docs/features/session-context.md) · [Appearance](docs/features/appearance-settings.md)
- [Archive and restore](docs/features/archive-and-restore.md) · [Device copies and moves](docs/features/devices-and-moves.md) · [Chat history export](docs/features/chat-history-export.md) · [Language](docs/features/language.md)
- [API](docs/api.md) — RPC, host operations and CLI commands.
- [Data model](docs/data-model.md) — plugin-owned storage.
- [Deployment](docs/deployment.md) — installation and development commands.
- [Gotchas](docs/gotchas.md) — constraints and failure behavior.
- [Decisions](docs/decisions.md) — implementation choices supported by code and history.

The interface is available in English, Russian, Spanish, French, German, Portuguese, Simplified Chinese, Japanese, Korean, Hindi and Arabic (`i18n.tsx:13-37`).

See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Workspace Hub Tasks

Selecting a project on the management page shows its Hub task tree above the project settings. Parent rows expand to subtasks with statuses, assignees, columns, full child counts, issue links and active-chat actions. Search retains parent context; completed and canceled tasks are hidden by default. The overview refreshes every 15 seconds while visible, on focus and through its refresh action.

The integration calls Hub's versioned, read-only `project_tasks` RPC through the public BB SDK and validates the response. Projects without Hub setup have no task section; an unavailable Hub shows a retryable status without breaking project management. This section supports Russian and English, with English fallback for other locales.

> [!NOTE]
> Overview payloads contain at most 500 tasks in parent-first order and explicitly label truncation. Counters include all nonarchived tasks across boards, even when filtering or hiding completed tasks. Accepted and canceled tasks are not counted as Done. Opening the full Hub board remains available; this section never starts, moves, accepts or merges tasks.

The Projects sidebar also groups Hub worker chats by task and actual subtask ancestry, including previous attempts. Ordinary chats and existing section placement stay unchanged. Quiet subtasks start collapsed; unread, pinned and busy paths initially expand, and the current chat's path remains open. Disclosure is remembered per section. Existing chat limits and Show all apply before grouping; the number beside a task counts chats in the current list, including descendants, not completed subtasks. Issue titles open Hub; thread rows keep native navigation, menus and drag behavior.

Sidebar metadata uses the optional read-only `sidebar_tasks` RPC in batches of up to 200 thread IDs, with up to 1000 task records and 32 ancestor hops per batch. It refreshes every 15 seconds while visible and on focus. When Hub is unavailable or a chat has no authoritative mapping, its original flat row remains accessible. Only Hub-attributed chats are grouped; task associations are never guessed from titles.
