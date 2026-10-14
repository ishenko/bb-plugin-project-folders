import { useEffect, useState, type ReactNode } from "react";
import { useSdk, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { hubChatTree, hubSidebarSchema, type HubSidebar, type HubChatNode } from "./hub-sidebar-contract";
import { Icon } from "./components/ui/icon";
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

export function HubChatGroups({ threads, data, active, groupId, renderThread }: {
  threads: readonly PluginSidebarThread[]; data: HubSidebar; active: string | null;
  groupId: string; renderThread: (thread: PluginSidebarThread) => ReactNode;
}) {
  const russian = useLanguage() === "ru";
  const [closed, setClosed] = useState(readClosedGroups);
  const render = (node: HubChatNode, depth: number): ReactNode => {
    if (node.kind === "thread") return renderThread(node.thread);
    const id = `${groupId}:${node.task.id}`;
    const open = node.active || (closed[id] === undefined ? depth === 0 || node.important : !closed[id]);
    const label = `${node.task.key} ${node.task.title}`;
    const state = stateLabels[node.task.state][russian ? 1 : 0];
    const disclosure = `${open ? (russian ? "Свернуть" : "Collapse") : (russian ? "Раскрыть" : "Expand")} ${node.task.key}`;
    return <div className="pf-hub-chat-group" key={node.task.id} data-hub-issue-id={node.task.id} data-state={node.task.state}>
      <div className="pf-hub-chat-heading">
        <button type="button" className="pf-icon" title={disclosure} aria-label={disclosure} aria-expanded={open} disabled={node.active} onClick={() => {
          setClosed((old) => ({ ...old, [id]: open }));
          try { localStorage.setItem("project-folders:hub-chat-groups", JSON.stringify({ ...readClosedGroups(), [id]: open })); } catch { /* Storage may be disabled. */ }
        }}><Icon name={open ? "ChevronDown" : "ChevronRight"} /></button>
        <a className="pf-hub-chat-link" aria-label={label} title={label} href={`/plugins/hub/hub/p/${encodeURIComponent(node.task.projectId)}/issue/${encodeURIComponent(node.task.id)}`}>
          <code>{node.task.key}</code><span>{node.task.title}</span>
        </a>
        <span className="pf-hub-chat-count" title={russian ? "Чаты в текущем списке" : "Chats in the current list"}>{node.count}</span>
        <span className="pf-hub-chat-state" data-state={node.task.state} title={state} aria-label={state} />
        {node.task.archived ? <span title={russian ? "В архиве" : "Archived"}><Icon name="Archive" /></span> : null}
      </div>
      {open ? <div className="pf-hub-chat-children" style={{ marginInlineStart: depth < 4 ? 7 : 0 }}>{node.children.map((child) => render(child, depth + 1))}</div> : null}
    </div>;
  };
  return <>{hubChatTree(threads, data, active).map((node) => render(node, 0))}</>;
}
