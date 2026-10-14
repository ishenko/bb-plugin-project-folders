// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { HubChatGroups, useHubSidebar } from "./hub-sidebar";
import { hubChatTree, type HubSidebar, type HubChatNode } from "./hub-sidebar-contract";
import { installTestMatchMedia } from "./test-match-media";

const thread = (id: string, overrides: Partial<PluginSidebarThread> = {}): PluginSidebarThread => ({
  id, projectId: "p1", title: `Chat ${id}`, titleFallback: null, displayTitle: `Chat ${id}`,
  parentThreadId: null, lifecycleOwnerThreadId: null, sourceThreadId: null, sectionId: null,
  originKind: null, originPluginId: "hub", providerId: "codex", status: "idle", runtimeStatus: "idle", queuedWork: "none",
  hasPendingInteraction: false, activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
  indicator: "none", indicatorLabel: null, isUnread: false, isPinned: false, isArchived: false,
  environment: null, host: { id: "h1", name: "Mac" }, createdAt: Date.now(), updatedAt: Date.now(), lastReadAt: Date.now(), latestAttentionAt: Date.now(),
  ...overrides,
});
const data: HubSidebar = { version: 1, tasks: [
  { id: "parent", parentId: null, projectId: "p1", key: "TA-1", title: "Parent", state: "running", archived: false, subtaskCount: 6 },
  { id: "child", parentId: "parent", projectId: "p1", key: "TA-2", title: "Child", state: "done", archived: false, subtaskCount: 0 },
], threads: [{ threadId: "t1", issueId: "child" }, { threadId: "t2", issueId: "child" }, { threadId: "t3", issueId: "parent" }] };
const all = [thread("t1"), thread("t2"), thread("t3"), thread("plain", { originPluginId: null, title: "TA-2 misleading title" })];
const root = { id: "p1", projectId: "p1", hostId: "h1", parentId: null, path: "/work", name: "Project" };
let app: Awaited<ReturnType<typeof loadPluginApp>>;
beforeAll(async () => { installTestMatchMedia(); app = await loadPluginApp(() => import("./app")); });
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const ids = (nodes: HubChatNode[]): string[] => nodes.flatMap((node) => node.kind === "thread" ? [node.thread.id] : ids(node.children));

it("renders the full subtask count before the chevron and replaces the dot with a working menu", async () => {
  const slot = renderSlot({ component: HubChatGroups }, { threads: all, data, active: null, groupId: "p1", renderThread: (chat: PluginSidebarThread) => <span key={chat.id}>{chat.title}</span> });
  const heading = slot.container.querySelector(".pf-hub-chat-heading")!;
  const count = heading.querySelector(".pf-hub-chat-count")!;
  expect(count.textContent).toBe("6");
  expect(count.getAttribute("aria-label")).toBe("Subtasks: 6");
  expect(count.nextElementSibling?.getAttribute("aria-label")).toBe("Collapse TA-1");
  expect(slot.container.querySelector(".pf-hub-chat-state")).toBeNull();
  const childHeading = slot.container.querySelector('[data-hub-issue-id="child"] .pf-hub-chat-heading')!;
  expect(childHeading.querySelector(".pf-hub-chat-count")?.textContent).toBe("");
  fireEvent.pointerDown(slot.getByRole("button", { name: "Task actions: TA-2" }), { button: 0, ctrlKey: false });
  const link = await slot.findByRole("menuitem", { name: "Open in Hub" });
  expect(link.getAttribute("href")).toBe("/plugins/hub/hub/p/p1/issue/child");
  fireEvent.click(slot.getByRole("menuitem", { name: "Expand chats" }));
  expect(slot.getByText("Chat t1")).toBeTruthy();
  slot.lifecycle.unmount();
});

it("groups historical chats once with real ancestors and leaves ordinary or foreign chats flat", () => {
  const tree = hubChatTree(all, data, null);
  expect(tree[0].kind).toBe("task");
  expect(ids(tree)).toEqual(["t1", "t2", "t3", "plain"]);
  const parent = tree[0];
  expect(parent.kind === "task" && parent.count).toBe(3);
  const foreign = thread("t1", { projectId: "p2" });
  expect(hubChatTree([foreign], data, null)[0].kind).toBe("thread");
  expect(hubChatTree([all[3]], data, null)[0].kind).toBe("thread");
});

it("normalizes cycles and missing parents without losing chats", () => {
  const cyclic = { ...data, tasks: data.tasks.map((task) => task.id === "parent" ? { ...task, parentId: "child" } : task) };
  expect(ids(hubChatTree(all, cyclic, null)).sort()).toEqual(all.map((item) => item.id).sort());
  expect(ids(hubChatTree(all, { ...data, tasks: [data.tasks[1]] }, null))).toEqual(all.map((item) => item.id));
});

it("starts quiet subtask attempts collapsed, persists disclosure and keeps active chats open", async () => {
  const props = { threads: all, data, active: null, groupId: "p1", renderThread: (chat: PluginSidebarThread) => <span key={chat.id}>{chat.title}</span> };
  const slot = renderSlot({ component: HubChatGroups }, props);
  expect(slot.queryByText("Chat t1")).toBeNull();
  fireEvent.click(slot.getByRole("button", { name: "Expand TA-2" }));
  expect(slot.getByText("Chat t1")).toBeTruthy();
  fireEvent.click(slot.getByRole("button", { name: "Collapse TA-2" }));
  expect(JSON.parse(localStorage.getItem("project-folders:hub-chat-groups")!)["p1:child"]).toBe(true);
  slot.lifecycle.unmount();
  const active = renderSlot({ component: HubChatGroups }, { ...props, active: "t1" });
  expect(active.getByText("Chat t1")).toBeTruthy();
  expect(active.getByRole("button", { name: "Collapse TA-2" }).hasAttribute("disabled")).toBe(true);
  active.lifecycle.unmount();
});

it.each([{ isUnread: true }, { isPinned: true }, { hasPendingInteraction: true }, { status: "active" as const }])("auto expands important chat paths (%j)", (overrides) => {
  const slot = renderSlot({ component: HubChatGroups }, { threads: [thread("t1", overrides)], data, active: null, groupId: "p1", renderThread: (chat: PluginSidebarThread) => <span key={chat.id}>{chat.title}</span> });
  expect(slot.getByText("Chat t1")).toBeTruthy();
  slot.lifecycle.unmount();
});

it("disclosure in one section does not overwrite another section's preferences", () => {
  const props = { threads: all, data, active: null, renderThread: (chat: PluginSidebarThread) => <span key={chat.id}>{chat.title}</span> };
  const first = renderSlot({ component: HubChatGroups }, { ...props, groupId: "first" });
  const second = renderSlot({ component: HubChatGroups }, { ...props, groupId: "second" });
  fireEvent.click(first.container.querySelector('[aria-label="Expand TA-2"]')!);
  fireEvent.click(second.container.querySelector('[aria-label="Expand TA-2"]')!);
  expect(JSON.parse(localStorage.getItem("project-folders:hub-chat-groups")!)).toEqual({ "first:child": false, "second:child": false });
  first.lifecycle.unmount(); second.lifecycle.unmount();
});

function Probe({ threads }: { threads: PluginSidebarThread[] }) {
  const snapshot = useHubSidebar(threads);
  return <span>{snapshot.threads.length}</span>;
}

it("batches only Hub chats, flattens on failure and aborts on unmount", async () => {
  const chats = Array.from({ length: 201 }, (_, index) => thread(`t${index}`));
  let signal: AbortSignal | undefined;
  const callRpc = vi.fn(async (args: { input: { threadIds: string[] }; signal: AbortSignal }) => {
    signal = args.signal;
    return { ...data, threads: args.input.threadIds.map((threadId) => ({ threadId, issueId: "child" })) };
  });
  const slot = renderSlot({ component: Probe }, { threads: [...chats, all[3]] }, { sdk: { plugins: { callRpc } } });
  await slot.findByText("201");
  expect(callRpc).toHaveBeenCalledTimes(2);
  expect(callRpc.mock.calls.map(([args]) => args.input.threadIds.length)).toEqual([200, 1]);
  expect(callRpc.mock.calls.some(([args]) => args.input.threadIds.includes("plain"))).toBe(false);
  slot.lifecycle.unmount();
  expect(signal?.aborted).toBe(true);
  const failed = renderSlot({ component: Probe }, { threads: chats }, { sdk: { plugins: { callRpc: async () => { throw new Error("Offline"); } } } });
  await failed.findByText("0");
  failed.lifecycle.unmount();
});

it("falls back to original thread rows when Hub is unavailable", async () => {
  const callRpc = vi.fn(async () => { throw new Error("Hub unavailable"); });
  const slot = renderSlot(app.threadLists[0]!, { activeThreadId: null, onNavigate() {} }, {
    sidebarThreads: { threads: all, projects: [] },
    rpc: { list: () => ({ roots: [root], folders: [], bindings: {}, places: {}, errors: [] }) },
    sdk: { plugins: { callRpc } },
  });
  await waitFor(() => expect(callRpc).toHaveBeenCalled());
  await slot.findByText("Chat t1");
  expect(slot.container.querySelectorAll(".pf-thread")).toHaveLength(4);
  expect(slot.container.querySelector(".pf-hub-chat-group")).toBeNull();
  slot.lifecycle.unmount();
});

it("Show all still reveals old worker attempts inside their task without duplicates", async () => {
  const ago = Date.now() - 49 * 60 * 60 * 1000;
  const old = thread("t2", { createdAt: ago, updatedAt: ago, lastReadAt: ago, latestAttentionAt: ago });
  const slot = renderSlot(app.threadLists[0]!, { activeThreadId: "t1", onNavigate() {} }, {
    sidebarThreads: { threads: [thread("t1"), old], projects: [] },
    rpc: { list: () => ({ roots: [root], folders: [], bindings: {}, places: {}, errors: [] }) },
    sdk: { plugins: { callRpc: async () => data } },
  });
  await slot.findByRole("link", { name: "TA-2 Child" });
  expect(slot.queryByText("Chat t2")).toBeNull();
  fireEvent.click(slot.getByRole("button", { name: "Show all (2)" }));
  await slot.findByText("Chat t2");
  expect(slot.container.querySelectorAll('[data-sidebar-thread-id="t2"].pf-thread')).toHaveLength(1);
  slot.lifecycle.unmount();
});

it("preserves sidebar navigation, menus and separate section placement", async () => {
  const folder = { ...root, id: "f1", parentId: null, name: "Section", path: "/work/section" };
  const slot = renderSlot(app.threadLists[0]!, { activeThreadId: "t1", onNavigate() {} }, {
    sidebarThreads: { threads: all, projects: [] },
    rpc: { list: () => ({ roots: [root], folders: [folder], bindings: {}, places: { t2: "f1" }, errors: [] }) },
    sdk: { plugins: { callRpc: async () => data } },
  });
  expect(await slot.findAllByRole("link", { name: "TA-1 Parent" })).toHaveLength(2);
  const t1 = slot.getByText("Chat t1").closest("[data-sidebar-thread-id]")!;
  expect(t1.getAttribute("data-sidebar-thread-id")).toBe("t1");
  fireEvent.click(slot.getByText("Chat t1"));
  expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "open", threadId: "t1", options: { split: false } });
  fireEvent.contextMenu(slot.getByText("Chat t1"));
  expect(await slot.findByText("Move to section…")).toBeTruthy();
  fireEvent.keyDown(slot.getByRole("menu"), { key: "Escape" });
  const section = slot.getByText("Section").closest(".pf-folder")!;
  await waitFor(() => expect(section.querySelector('[data-hub-issue-id="child"]')).not.toBeNull());
  expect(t1.closest(".pf-folder")).not.toBe(section);
  slot.lifecycle.unmount();
});
