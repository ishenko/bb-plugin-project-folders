import { useEffect, useState } from "react";
import { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { hubTaskRows, hubTasksSchema, type HubTask, type HubTasks } from "./hub-tasks-contract";
import { useLanguage } from "./i18n";
import { Icon } from "./components/ui/icon";
import "./hub-tasks.css";

const en = {
  tasks: "Workspace Hub", subtasks: "Subtasks", done: "Done", running: "In progress", attention: "Needs attention",
  search: "Filter tasks", hideDone: "Hide completed", refresh: "Refresh tasks", unavailable: "Workspace Hub is unavailable",
  empty: "No matching tasks", open: "Open in Hub", expand: "Expand subtasks", collapse: "Collapse subtasks",
  thread: "Open active chat", partial: "Showing the first 500 tasks", canceled: "Canceled",
};
const ru: typeof en = {
  tasks: "Workspace Hub", subtasks: "Подзадачи", done: "Готово", running: "В работе", attention: "Требуют внимания",
  search: "Фильтр задач", hideDone: "Скрыть готовые", refresh: "Обновить задачи", unavailable: "Workspace Hub недоступен",
  empty: "Нет задач по фильтру", open: "Открыть в Hub", expand: "Раскрыть подзадачи", collapse: "Свернуть подзадачи",
  thread: "Открыть активный чат", partial: "Показаны первые 500 задач", canceled: "Отменено",
};
const states: Record<HubTask["state"], [string, string]> = {
  open: ["Open", "Открыта"], queued: ["Queued", "В очереди"], running: ["In progress", "В работе"],
  waiting: ["Waiting", "Ожидает"], blocked: ["Blocked", "Заблокирована"], paused: ["Paused", "На паузе"],
  review: ["In review", "На ревью"], accepted: ["Accepted", "Принята"], done: ["Done", "Готово"],
  failed: ["Failed", "Ошибка"], stopped: ["Stopped", "Остановлена"], canceled: ["Canceled", "Отменена"],
};

export function HubProjectTasks({ projectId }: { projectId: string }) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const russian = useLanguage() === "ru";
  const labels = russian ? ru : en;
  const [snapshot, setSnapshot] = useState<HubTasks | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [hideDone, setHideDone] = useState(true);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      try {
        const result = await sdk.plugins.callRpc({ pluginId: "hub", method: "project_tasks", input: { projectId }, outputSchema: hubTasksSchema, signal: controller.signal });
        if (!controller.signal.aborted) {
          if (result.projectId !== projectId) throw new Error("Project mismatch");
          setSnapshot(result);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally { busy = false; }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    const focus = () => { if (!document.hidden) void load(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [sdk, projectId, refresh]);

  const data = snapshot?.projectId === projectId ? snapshot : null;
  if (!data && !error) return null;
  if (data && !data.configured && !error) return null;
  const rows = data ? hubTaskRows(data.issues, hideDone, query, expanded) : [];
  const toggle = (id: string) => setExpanded((old) => {
    const next = new Set(old);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <section className="pf-hub-tasks" aria-label={labels.tasks}>
      <header className="pf-hub-heading">
        <h2><Icon name="ListTodo" />{labels.tasks}</h2>
        <a className="pf-hub-open" href={`/plugins/hub/hub/p/${encodeURIComponent(projectId)}/board`}>{labels.open}<Icon name="ChevronRight" /></a>
        <button type="button" className="pf-icon" aria-label={labels.refresh} title={labels.refresh} onClick={() => setRefresh((value) => value + 1)}><Icon name="FolderSync" /></button>
      </header>
      {error ? <p role="status" className="pf-hub-unavailable">{labels.unavailable}</p> : null}
      {data ? <>
        <div className="pf-hub-summary">
          <span>{labels.done} <b>{data.counts.done}/{data.counts.total}</b></span>
          <span>{labels.subtasks} <b>{data.subtasks.done}/{data.subtasks.total}</b></span>
          <span data-tone="active">{labels.running} <b>{data.counts.running}</b></span>
          <span data-tone="attention">{labels.attention} <b>{data.counts.attention}</b></span>
          {data.counts.canceled ? <span>{labels.canceled} <b>{data.counts.canceled}</b></span> : null}
        </div>
        <div className="pf-hub-filters">
          <input type="search" aria-label={labels.search} placeholder={labels.search} value={query} onChange={(event) => setQuery(event.target.value)} />
          <label><input type="checkbox" checked={hideDone} onChange={(event) => setHideDone(event.target.checked)} />{labels.hideDone}</label>
        </div>
        <ul className="pf-hub-tree">
          {rows.map(({ task, depth, hasChildren, expanded: open, contextOnly }) => (
            <li key={task.id} className="pf-hub-row" data-state={task.state} data-context={contextOnly || undefined} data-depth={depth} style={{ paddingInlineStart: `${Math.min(depth, 6) * 16}px` }}>
              {hasChildren ? <button type="button" className="pf-icon" aria-label={`${open ? labels.collapse : labels.expand} ${task.key}`} aria-expanded={open} disabled={Boolean(query)} onClick={() => toggle(task.id)}><Icon name={open ? "ChevronDown" : "ChevronRight"} /></button> : <span className="pf-hub-indent" />}
              <div className="pf-hub-task">
                <a href={task.href} aria-label={`${task.key} ${task.title}`} className="pf-hub-task-link"><code>{task.key}</code><span>{task.title}</span></a>
                <div className="pf-hub-meta">
                  <span className="pf-hub-state">{states[task.state][russian ? 1 : 0]}</span>
                  {task.assignee ? <span>{task.assignee}</span> : null}
                  {task.column ? <span>{task.column}</span> : null}
                  {task.subtasks.total ? <span>{labels.subtasks} {task.subtasks.done}/{task.subtasks.total}</span> : null}
                </div>
              </div>
              {task.threadId ? <button type="button" className="pf-icon" title={labels.thread} aria-label={`${labels.thread} ${task.key}`} onClick={() => navigate.toThread(task.threadId!)}><Icon name="MessageSquare" /></button> : null}
            </li>
          ))}
        </ul>
        {rows.length === 0 ? <p className="pf-hub-empty">{labels.empty}</p> : null}
        {data.partial ? <p role="status" className="pf-hub-empty">{labels.partial} <a href={`/plugins/hub/hub/p/${encodeURIComponent(projectId)}/board`}>{labels.open}</a></p> : null}
      </> : null}
    </section>
  );
}
