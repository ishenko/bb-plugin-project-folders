// @vitest-environment jsdom
import { beforeAll, afterEach, expect, it } from "vitest";
import { fireEvent, waitFor, cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { installTestMatchMedia, setCompactViewport } from "./test-match-media";
let app: Awaited<ReturnType<typeof loadPluginApp>>;
beforeAll(async () => {
  installTestMatchMedia();
  app = await loadPluginApp(() => import("./app"));
});
afterEach(() => {
  setCompactViewport(false);
  cleanup();
  localStorage.clear();
});
const now = Date.now();
const thread: PluginSidebarThread = {
  id: "t1",
  projectId: "p1",
  title: "Example chat",
  titleFallback: null,
  parentThreadId: null,
  sectionId: null,
  originKind: null,
  originPluginId: null,
  providerId: "codex",
  hasPendingInteraction: false,
  activity: {
    workflows: 0,
    backgroundAgents: 0,
    backgroundCommands: 0,
    planMode: 0,
    goals: 0,
  },
  indicator: "none",
  indicatorLabel: null,
  isUnread: false,
  isPinned: false,
  environment: {
    id: "e1",
    name: null,
    branchName: null,
    providerId: null,
    workspaceDisplayKind: null,
  },
  host: { id: "h1", name: "Mini" },
  createdAt: now,
  updatedAt: now,
  lastReadAt: now,
  latestAttentionAt: now,
};
const root = {
  id: "p1",
  projectId: "p1",
  hostId: "h1",
  parentId: null,
  path: "/work",
  name: "Project",
};
const tags = [
  { id: "bug", name: "Bug", color: "red" },
  { id: "idea", name: "Idea", color: "#00aa55" },
];

it("shows the chat's label as a chip and changes it from the chat menu", async () => {
  const view = renderSlot(
    app.threadLists[0]!,
    { activeThreadId: null, onNavigate() {} },
    {
      sidebarThreads: { threads: [thread], projects: [] },
      rpc: {
        list: () => ({ folders: [], roots: [root], bindings: {}, errors: [] }),
        tags_get: () => ({ tags, assignments: { t1: "bug" } }),
        thread_tag_set: () => ({ ok: true }),
      },
    },
  );
  const chip = await view.findByText("Bug");
  expect(chip.classList.contains("pf-tag-chip")).toBe(true);
  expect(chip.closest(".pf-thread")?.textContent).toContain("Example chat");

  fireEvent.contextMenu(await view.findByText("Example chat"));
  const sub = await view.findByRole("menuitem", { name: /Label/ });
  fireEvent.keyDown(sub, { key: "ArrowRight" });
  const idea = await view.findByRole("menuitemradio", { name: /Idea/ });
  expect(
    view
      .getByRole("menuitemradio", { name: /Bug/ })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(view.getByRole("menuitemradio", { name: /No label/ })).toBeTruthy();
  fireEvent.click(idea);
  await waitFor(() =>
    expect(
      view.inspection.rpcCalls.some(
        (c) =>
          c.method === "thread_tag_set" &&
          JSON.stringify(c).includes('"tagId":"idea"'),
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(
      view.container.querySelector(".pf-tag-chip")?.textContent,
    ).toBe("Idea"),
  );
  view.lifecycle.unmount();
});

it("loads labels once for many chat rows and once per change", async () => {
  const threads = Array.from({ length: 12 }, (_, i) => ({
    ...thread,
    id: `m${i}`,
    title: `Chat ${i}`,
  }));
  const view = renderSlot(
    app.threadLists[0]!,
    { activeThreadId: null, onNavigate() {} },
    {
      sidebarThreads: { threads, projects: [] },
      rpc: {
        list: () => ({ folders: [], roots: [root], bindings: {}, errors: [] }),
        tags_get: () => ({ tags, assignments: {} }),
      },
    },
  );
  await view.findByText("Chat 0");
  const loads = () =>
    view.inspection.rpcCalls.filter((c) => c.method === "tags_get").length;
  const before = loads();
  await view.emitRealtime("tags", {});
  await waitFor(() => expect(loads()).toBeGreaterThan(before));
  await new Promise((r) => setTimeout(r, 50));
  expect(loads() - before).toBeLessThanOrEqual(2);
  view.lifecycle.unmount();
});

it("on phones picks the label in its own sheet instead of a long submenu", async () => {
  setCompactViewport(true);
  const view = renderSlot(
    app.threadLists[0]!,
    { activeThreadId: null, onNavigate() {} },
    {
      sidebarThreads: { threads: [thread], projects: [] },
      rpc: {
        list: () => ({ folders: [], roots: [root], bindings: {}, errors: [] }),
        tags_get: () => ({ tags, assignments: {} }),
        thread_tag_set: () => ({ ok: true }),
      },
    },
  );
  fireEvent.click(
    await view.findByRole("button", { name: "Chat actions" }),
  );
  // The chat menu stays short: one «Label» row, no label list inside it.
  expect(view.queryByRole("menuitemradio", { name: /Idea/ })).toBeNull();
  fireEvent.click(await view.findByRole("menuitem", { name: /^Label/ }));
  fireEvent.click(await view.findByRole("radio", { name: /Idea/ }));
  await waitFor(() =>
    expect(
      view.inspection.rpcCalls.some(
        (c) =>
          c.method === "thread_tag_set" &&
          JSON.stringify(c).includes('"tagId":"idea"'),
      ),
    ).toBe(true),
  );
  await waitFor(() => expect(view.queryByRole("radio")).toBeNull());
  view.lifecycle.unmount();
});

it("edits a label in its own dialog from the settings list", async () => {
  let saved: unknown = null;
  const view = renderSlot(
    app.navPanels[0]!,
    { subPath: "settings/tags" },
    {
      rpc: {
        list: () => ({
          folders: [],
          roots: [],
          bindings: {},
          places: {},
          errors: [],
          machines: [],
        }),
        tags_get: () => ({ tags, assignments: { t1: "bug" } }),
        tag_save: (input: { id?: string; name: string; color: string }) => {
          saved = input;
          return { id: input.id ?? "new", name: input.name, color: input.color };
        },
      },
    },
  );
  fireEvent.click(await view.findByRole("button", { name: /^Bug/ }));
  const name = await view.findByRole("textbox", { name: "Label name" });
  fireEvent.change(name, { target: { value: "Bugfix" } });
  fireEvent.click(view.getByRole("radio", { name: "blue" }));
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(saved).toEqual({ id: "bug", name: "Bugfix", color: "blue" }),
  );
  await waitFor(() =>
    expect(view.queryByRole("textbox", { name: "Label name" })).toBeNull(),
  );
  view.lifecycle.unmount();
});

it("creates a new label from settings without sending an empty id", async () => {
  let saved: unknown = null;
  const view = renderSlot(
    app.navPanels[0]!,
    { subPath: "settings/tags" },
    {
      rpc: {
        list: () => ({
          folders: [],
          roots: [],
          bindings: {},
          places: {},
          errors: [],
          machines: [],
        }),
        tags_get: () => ({ tags: [], assignments: {} }),
        tag_save: (input: Record<string, unknown>) => {
          saved = input;
          return { id: "n1", name: input.name, color: input.color };
        },
      },
    },
  );
  fireEvent.click(await view.findByRole("button", { name: /Add label/ }));
  fireEvent.change(
    await view.findByRole("textbox", { name: "Label name" }),
    { target: { value: "Ops" } },
  );
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saved).not.toBeNull());
  expect(Object.keys(saved as object).sort()).toEqual(["color", "name"]);
  expect(await view.findByText("Ops")).toBeTruthy();
  view.lifecycle.unmount();
});
