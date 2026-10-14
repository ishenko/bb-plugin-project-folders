import { z } from "zod";

const counts = z.object({
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  attention: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
});

// Versioned, read-only Hub integration. No imports from another plugin's checkout.
export const hubTasksSchema = z.object({
  version: z.literal(1),
  projectId: z.string(),
  configured: z.boolean(),
  counts,
  subtasks: counts,
  totalIssues: z.number().int().nonnegative(),
  partial: z.boolean(),
  issues: z.array(z.object({
    id: z.string(),
    parentId: z.string().nullable(),
    key: z.string(),
    title: z.string(),
    state: z.enum(["open", "queued", "running", "waiting", "blocked", "paused", "review", "accepted", "done", "failed", "stopped", "canceled"]),
    assignee: z.string().nullable(),
    threadId: z.string().nullable(),
    board: z.string(),
    column: z.string(),
    subtasks: counts,
    href: z.string().regex(/^\/plugins\/hub\/hub\/p\/[^/]+\/issue\/[^/]+$/u),
  })).max(500),
});

export type HubTasks = z.infer<typeof hubTasksSchema>;
export type HubTask = HubTasks["issues"][number];

export function hubTaskRows(tasks: readonly HubTask[], hideDone: boolean, query: string, expanded: ReadonlySet<string>) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const included = new Set<string>();
  const matches = new Set<string>();
  for (const task of tasks) {
    if (hideDone && ["done", "canceled"].includes(task.state)) continue;
    if (query && !`${task.key} ${task.title} ${task.assignee ?? ""}`.toLowerCase().includes(query.toLowerCase())) continue;
    matches.add(task.id);
    let current: HubTask | undefined = task;
    while (current && !included.has(current.id)) {
      included.add(current.id);
      current = byId.get(current.parentId ?? "");
    }
  }
  const children = new Map<string, HubTask[]>();
  const roots: HubTask[] = [];
  for (const task of tasks) {
    if (!included.has(task.id)) continue;
    if (!task.parentId || !included.has(task.parentId)) roots.push(task);
    else {
      const list = children.get(task.parentId) ?? [];
      list.push(task);
      children.set(task.parentId, list);
    }
  }
  const rows: Array<{ task: HubTask; depth: number; hasChildren: boolean; expanded: boolean; contextOnly: boolean }> = [];
  const stack = [...roots].reverse().map((task) => ({ task, depth: 0 }));
  const seen = new Set<string>();
  while (stack.length) {
    const { task, depth } = stack.pop()!;
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    const list = children.get(task.id) ?? [];
    const isExpanded = Boolean(query) || expanded.has(task.id);
    rows.push({ task, depth, hasChildren: list.length > 0, expanded: isExpanded, contextOnly: !matches.has(task.id) });
    if (isExpanded) for (const child of [...list].reverse()) stack.push({ task: child, depth: depth + 1 });
  }
  return rows;
}
