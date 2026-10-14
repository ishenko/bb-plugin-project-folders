import { useEffect, useState, type ReactNode } from "react";
import { useSdk, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { hubChatTree, hubSidebarSchema, type HubSidebar, type HubChatNode } from "./hub-sidebar-contract";
import { Icon } from "./components/ui/icon";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "./components/ui/dropdown-menu";
import { useLanguage } from "./i18n";
import "./hub-sidebar.css";

const empty: HubSidebar = { version: 1, tasks: [], threads: [] };
const stateLabels = {
  open: ["Open", "Открыта"], queued: ["Queued", "В очереди"], running: ["In progress", "В работе"],
  waiting: ["Waiting", "Ожидает"], blocked: ["Blocked", "Заблокирована"], paused: ["Paused", "На паузе"],
  review: ["In review", "На ревью"], accepted: ["Accepted", "Принята"], done: ["Done", "Готово"],
  failed: ["Failed", "Ошибка"], stopped: ["Stopped", "Остановлена"], canceled: ["Canceled", "Отменена"],
};

function readClosedGroups(): Record<string, boolean> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem("project-folders:hub-chat-groups") ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === "boolean")) : {};
  } catch { return {}; }
}

export function useHubSidebar(threads: readonly PluginSidebarThread[]) {
  const sdk = useSdk();
  const ids = JSON.stringify([...new Set(threads.filter((thread) => thread.originPluginId === "hub").map((thread) => thread.id))].sort());
  const [snapshot, setSnapshot] = useState<HubSidebar>(empty);
  useEffect(() => {
    const threadIds = JSON.parse(ids) as string[];
    const controller = new AbortController();
    let busy = false;
    if (!threadIds.length) { setSnapshot(empty); return () => controller.abort(); }
    const load = async () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      try {
        const next: HubSidebar = { version: 1, tasks: [], threads: [] };
        // Bound every public RPC and only accept mappings for requested chats.
        for (let start = 0; start < threadIds.length; start += 200) {
          const batch = threadIds.slice(start, start + 200);
          const result = await sdk.plugins.callRpc({ pluginId: "hub", method: "sidebar_tasks", input: { threadIds: batch }, outputSchema: hubSidebarSchema, signal: controller.signal });
          next.tasks.push(...result.tasks);
          next.threads.push(...result.threads.filter((link) => batch.includes(link.threadId)));
        }
        if (!controller.signal.aborted) setSnapshot(next);
      } catch {
        if (!controller.signal.aborted) setSnapshot(empty);
      } finally { busy = false; }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    const focus = () => { if (!document.hidden) void load(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      controller.abort(); clearInterval(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [sdk, ids]);
  return snapshot;
}

export type HubThreadDecoration = { leading: ReactNode; menuItems: ReactNode; title: string };

export function HubChatGroups({ threads, contextThreads = threads, data, active, groupId, renderThread }: {
  threads: readonly PluginSidebarThread[]; data: HubSidebar; active: string | null;
  contextThreads?: readonly PluginSidebarThread[];
  groupId: string; renderThread: (thread: PluginSidebarThread, decoration?: HubThreadDecoration) => ReactNode;
}) {
  const russian = useLanguage() === "ru";
  const [closed, setClosed] = useState(readClosedGroups);
  const links = new Map(data.threads.map((link) => [link.threadId, link.issueId]));
  const context = new Map<string, PluginSidebarThread[]>();
  for (const thread of contextThreads) {
    const issueId = links.get(thread.id);
    if (!issueId || thread.originPluginId !== "hub" || thread.isArchived) continue;
    const list = context.get(issueId) ?? [];
    list.push(thread);
    context.set(issueId, list);
  }
  const render = (node: HubChatNode, depth: number): ReactNode => {
    if (node.kind === "thread") return renderThread(node.thread);
    const id = `${groupId}:${node.task.id}`;
    const directThreads = node.children.filter((child): child is Extract<HubChatNode, { kind: "thread" }> => child.kind === "thread");
    const candidates = (context.get(node.task.id) ?? []).filter((thread) => thread.projectId === node.task.projectId);
    const parent = candidates.find((thread) => thread.id === active) ?? directThreads.find((child) => child.thread.id === active)?.thread ?? directThreads[0]?.thread ?? candidates[0];
    const children = node.children.filter((child) => child.kind !== "thread" || child.thread.id !== parent?.id);
    const keepOpen = node.active && parent?.id !== active;
    const open = keepOpen || (closed[id] === undefined ? depth === 0 || node.important : !closed[id]);
    const label = `${node.task.key} ${node.task.title}`;
    const state = stateLabels[node.task.state][russian ? 1 : 0];
    const disclosure = `${open ? (russian ? "Свернуть" : "Collapse") : (russian ? "Раскрыть" : "Expand")} ${node.task.key}`;
    const href = `/plugins/hub/hub/p/${encodeURIComponent(node.task.projectId)}/issue/${encodeURIComponent(node.task.id)}`;
    const toggle = () => {
      setClosed((old) => ({ ...old, [id]: open }));
      try { localStorage.setItem("project-folders:hub-chat-groups", JSON.stringify({ ...readClosedGroups(), [id]: open })); } catch { /* Storage may be disabled. */ }
    };
    const leading = <button type="button" className="pf-icon pf-hub-disclosure" title={disclosure} aria-label={disclosure} aria-expanded={open} disabled={keepOpen || !children.length} draggable={false} onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); toggle(); }} onContextMenu={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
      <Icon name={open ? "ChevronDown" : "ChevronRight"} />
    </button>;
    const menuItems = <>
      <DropdownMenuItem asChild><a className="pf-hub-chat-menu-link" href={href}><Icon name="ExternalLink" />{russian ? "Открыть в Hub" : "Open in Hub"}</a></DropdownMenuItem>
      <DropdownMenuItem disabled={keepOpen || !children.length} onSelect={toggle}><Icon name={open ? "ChevronDown" : "ChevronRight"} />{open ? (russian ? "Свернуть чаты" : "Collapse chats") : (russian ? "Раскрыть чаты" : "Expand chats")}</DropdownMenuItem>
    </>;
    return <div className="pf-hub-chat-group" key={node.task.id} data-hub-issue-id={node.task.id} data-state={node.task.state}>
      {parent ? <div className="pf-hub-chat-parent">{renderThread(parent, { leading, menuItems, title: `${label} · ${state}` })}</div> : <div className="pf-hub-chat-heading">
        {leading}
        <a className="pf-hub-chat-link" aria-label={label} title={`${label} · ${state}`} href={href}>
          <code>{node.task.key}</code><span>{node.task.title}</span>
        </a>
        {node.task.archived ? <span title={russian ? "В архиве" : "Archived"}><Icon name="Archive" /></span> : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="pf-icon" title={russian ? "Действия задачи" : "Task actions"} aria-label={`${russian ? "Действия задачи" : "Task actions"}: ${node.task.key}`}><Icon name="MoreHorizontal" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menuItems}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>}
      {open && children.length ? <div className="pf-hub-chat-children" style={{ marginInlineStart: depth < 4 ? 7 : 0 }}>{children.map((child) => render(child, depth + 1))}</div> : null}
    </div>;
  };
  return <>{hubChatTree(threads, data, active).map((node) => render(node, 0))}</>;
}
