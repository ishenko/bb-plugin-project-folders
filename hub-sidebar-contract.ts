import { z } from "zod";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { isThreadBusy } from "./chat-list";

export const hubSidebarSchema = z.object({
  version: z.literal(1),
  tasks: z.array(z.object({
    id: z.string(), projectId: z.string(), parentId: z.string().nullable(),
    key: z.string(), title: z.string(),
    state: z.enum(["open", "queued", "running", "waiting", "blocked", "paused", "review", "accepted", "done", "failed", "stopped", "canceled"]),
    archived: z.boolean(),
  })).max(1000),
  threads: z.array(z.object({ threadId: z.string(), issueId: z.string() })).max(200),
});
export type HubSidebar = z.infer<typeof hubSidebarSchema>;
export type SidebarTask = HubSidebar["tasks"][number];
export type HubChatNode =
  | { kind: "thread"; thread: PluginSidebarThread }
  | { kind: "task"; task: SidebarTask; children: HubChatNode[]; count: number; important: boolean; active: boolean };

export function hubChatTree(threads: readonly PluginSidebarThread[], data: HubSidebar, active: string | null): HubChatNode[] {
  const tasks = new Map(data.tasks.map((task) => [task.id, task]));
  const links = new Map(data.threads.map((link) => [link.threadId, link.issueId]));
  const parents = new Map<string, string | null>();
  for (const task of tasks.values()) {
    const parent = tasks.get(task.parentId ?? "");
    parents.set(task.id, parent && parent.id !== task.id && parent.projectId === task.projectId ? parent.id : null);
  }
  const visited = new Set<string>();
  for (const id of tasks.keys()) {
    const path = new Set<string>();
    let cursor: string | null = id;
    while (cursor && !visited.has(cursor)) {
      if (path.has(cursor)) { parents.set(cursor, null); break; }
      path.add(cursor);
      cursor = parents.get(cursor) ?? null;
    }
    for (const entry of path) visited.add(entry);
  }
  const groups = new Map<string, Extract<HubChatNode, { kind: "task" }>>();
  const roots: HubChatNode[] = [];
  for (const thread of threads) {
    const task = tasks.get(links.get(thread.id) ?? "");
    if (!task || task.projectId !== thread.projectId || thread.originPluginId !== "hub") {
      roots.push({ kind: "thread", thread });
      continue;
    }
    const chain = [task];
    let parent = tasks.get(parents.get(task.id) ?? "");
    while (parent) { chain.push(parent); parent = tasks.get(parents.get(parent.id) ?? ""); }
    let container = roots;
    for (const ancestor of chain.reverse()) {
      let group = groups.get(ancestor.id);
      if (!group) {
        group = { kind: "task", task: ancestor, children: [], count: 0, important: false, active: false };
        groups.set(ancestor.id, group);
        container.push(group);
      }
      group.count += 1;
      group.active ||= thread.id === active;
      group.important ||= group.active || thread.isUnread || thread.isPinned || isThreadBusy(thread);
      container = group.children;
    }
    container.push({ kind: "thread", thread });
  }
  return roots;
}
