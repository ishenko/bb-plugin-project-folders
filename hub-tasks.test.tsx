// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { HubProjectTasks } from "./hub-tasks";
import { hubTaskRows, hubTasksSchema, type HubTask, type HubTasks } from "./hub-tasks-contract";

const empty = { total: 0, done: 0, running: 0, attention: 0, canceled: 0 };
const task = (id: string, extra: Partial<HubTask> = {}): HubTask => ({
  id, parentId: null, key: `TA-${id}`, title: `Task ${id}`, state: "open", assignee: null,
  threadId: null, board: "Development", column: "Backlog", subtasks: empty, href: `/plugins/hub/hub/p/p1/issue/${id}`, ...extra,
});
const snapshot = (projectId = "p1"): HubTasks => ({
  version: 1, projectId, configured: true, counts: { ...empty, total: 3, done: 1, running: 1 },
  subtasks: { ...empty, total: 2, done: 1, running: 1 }, totalIssues: 3, partial: false,
  issues: [task("1", { subtasks: { ...empty, total: 2, done: 1, running: 1 } }), task("2", { parentId: "1", state: "running", threadId: "thr_work", assignee: "Developer" }), task("3", { parentId: "1", state: "done" })],
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it("preserves ancestors in search and never changes full subtask counts", () => {
  const data = snapshot();
  const rows = hubTaskRows(data.issues, true, "Developer", new Set());
  expect(rows.map((row) => [row.task.id, row.depth, row.contextOnly])).toEqual([["1", 0, true], ["2", 1, false]]);
  expect(rows[0].task.subtasks).toEqual(data.issues[0].subtasks);
  expect(hubTaskRows(data.issues, true, "", new Set()).map((row) => row.task.id)).toEqual(["1"]);
});

it("shows a parsed, read-only Hub tree, completed filter and active chat navigation", async () => {
  const callRpc = vi.fn(async () => hubTasksSchema.parse(snapshot()));
  const slot = renderSlot({ component: HubProjectTasks }, { projectId: "p1" }, { sdk: { plugins: { callRpc } } });
  await slot.findByText("Task 1");
  expect(slot.queryByText("Task 2")).toBeNull();
  fireEvent.click(slot.getByRole("button", { name: "Expand subtasks TA-1" }));
  await slot.findByText("Task 2");
  expect(slot.queryByText("Task 3")).toBeNull();
  fireEvent.click(slot.getByRole("checkbox", { name: "Hide completed" }));
  await slot.findByText("Task 3");
  expect(slot.getByRole("link", { name: "TA-2 Task 2" }).getAttribute("href")).toBe("/plugins/hub/hub/p/p1/issue/2");
  fireEvent.click(slot.getByRole("button", { name: "Open active chat TA-2" }));
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_work" });
  expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "hub", method: "project_tasks", input: { projectId: "p1" } }));
  slot.lifecycle.unmount();
});

it("shows unavailable state and supports retry without affecting Projects", async () => {
  const callRpc = vi.fn().mockRejectedValueOnce(new Error("Plugin disabled")).mockResolvedValue(snapshot());
  const slot = renderSlot({ component: HubProjectTasks }, { projectId: "p1" }, { sdk: { plugins: { callRpc } } });
  await slot.findByText("Workspace Hub is unavailable");
  fireEvent.click(slot.getByRole("button", { name: "Refresh tasks" }));
  await slot.findByText("Task 1");
  expect(slot.queryByText("Workspace Hub is unavailable")).toBeNull();
  slot.lifecycle.unmount();
});

it("rejects another project's snapshot and aborts the request on unmount", async () => {
  let signal: AbortSignal | undefined;
  const callRpc = vi.fn(async (args: { signal?: AbortSignal }) => { signal = args.signal; return snapshot("wrong"); });
  const slot = renderSlot({ component: HubProjectTasks }, { projectId: "p1" }, { sdk: { plugins: { callRpc } } });
  await slot.findByText("Workspace Hub is unavailable");
  expect(slot.queryByText("Task 1")).toBeNull();
  slot.lifecycle.unmount();
  expect(signal?.aborted).toBe(true);
});

it("hides the integration for projects not configured in Hub", async () => {
  const slot = renderSlot({ component: HubProjectTasks }, { projectId: "p1" }, { sdk: { plugins: { callRpc: async () => ({ ...snapshot(), configured: false }) } } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(slot.queryByRole("region", { name: "Workspace Hub" })).toBeNull();
  slot.lifecycle.unmount();
});
