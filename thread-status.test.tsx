// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { ThreadStatus } from "./thread-status";
import { installTestMatchMedia } from "./test-match-media";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const idle = {
  indicator: "none" as const,
  indicatorLabel: null,
  hasPendingInteraction: false,
};

it("replaces a running spinner with a circled check when the turn finishes", () => {
  const view = render(
    <ThreadStatus
      thread={{ ...idle, indicator: "runtime", indicatorLabel: "Working" }}
    />,
  );
  expect(
    view.container.querySelector('[data-icon="Spinner"].pf-status-spinner'),
  ).not.toBeNull();
  expect(view.getByRole("img", { name: "Working" })).toBeTruthy();
  view.rerender(<ThreadStatus thread={idle} />);
  expect(
    view.container.querySelector('[data-icon="CircleCheck"]'),
  ).not.toBeNull();
  expect(view.container.querySelector(".pf-status-spinner")).toBeNull();
  expect(view.getByRole("img", { name: "Done" })).toBeTruthy();
});

it("uses the plugin language for the completion label", () => {
  localStorage.setItem("project-folders:language", "ru");
  const view = render(<ThreadStatus thread={idle} />);
  expect(view.getByRole("img", { name: "Готово" })).toBeTruthy();
});

it.each(["starting", "active", "stopping", "provisioning"])(
  "spins during host runtime state %s",
  (runtimeStatus) => {
    const view = render(<ThreadStatus thread={{ ...idle, runtimeStatus }} />);
    expect(
      view.container.querySelector('[data-icon="Spinner"].pf-status-spinner'),
    ).not.toBeNull();
  },
);

it.each([
  "working-draft",
  "workflow",
  "background-agent",
  "background-command",
] as const)("spins during %s", (indicator) => {
  const view = render(<ThreadStatus thread={{ ...idle, indicator }} />);
  expect(
    view.container.querySelector('[data-icon="Spinner"].pf-status-spinner'),
  ).not.toBeNull();
});

it("keeps an approval/question distinct from working and done", () => {
  const view = render(
    <ThreadStatus
      thread={{
        ...idle,
        indicator: "runtime",
        hasPendingInteraction: true,
        indicatorLabel: "Needs input",
      }}
    />,
  );
  expect(
    view.container.querySelector('[data-icon="MessageQuestion"]'),
  ).not.toBeNull();
  expect(view.container.querySelector(".pf-status-spinner")).toBeNull();
  expect(view.getByRole("img", { name: "Needs input" })).toBeTruthy();
});

it.each([
  { indicator: "unread-error" as const },
  { runtimeStatus: "failed" },
  { queuedWork: "failed" },
])("does not label errors as done: %j", (state) => {
  const view = render(<ThreadStatus thread={{ ...idle, ...state }} />);
  expect(
    view.container.querySelector('[data-icon="AlertCircle"]'),
  ).not.toBeNull();
  expect(view.container.querySelector('[data-icon="CircleCheck"]')).toBeNull();
});

it.each([
  { indicator: "draft" as const },
  { indicator: "plan-mode" as const },
  { indicator: "goal" as const },
  { runtimeStatus: "waiting-for-host" },
  { queuedWork: "waiting" },
])("does not label waiting/drafts as done: %j", (state) => {
  const view = render(<ThreadStatus thread={{ ...idle, ...state }} />);
  expect(view.container.querySelector('[data-icon="Circle"]')).not.toBeNull();
  expect(view.container.querySelector('[data-icon="CircleCheck"]')).toBeNull();
});

let app: Awaited<ReturnType<typeof loadPluginApp>>;
beforeAll(async () => {
  installTestMatchMedia();
  app = await loadPluginApp(() => import("./app"));
});

it("renders the new icons before thread titles in the actual project sidebar", async () => {
  const thread: PluginSidebarThread = {
    ...idle,
    id: "t1",
    projectId: "p1",
    title: "Working chat",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    indicator: "runtime",
    indicatorLabel: "Working",
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: {
      id: "e1",
      name: null,
      branchName: null,
      providerId: null,
      workspaceDisplayKind: null,
    },
    host: { id: "h1", name: "Mac" },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastReadAt: Date.now(),
    latestAttentionAt: Date.now(),
  };
  const view = renderSlot(
    app.threadLists[0]!,
    { activeThreadId: null, onNavigate() {} },
    {
      sidebarThreads: {
        threads: [thread, { ...thread, ...idle, id: "t2", title: "Done chat" }],
        projects: [],
      },
      rpc: {
        list: () => ({
          folders: [],
          roots: [
            {
              id: "p1",
              projectId: "p1",
              hostId: "h1",
              parentId: null,
              path: "/work",
              name: "Project",
            },
          ],
          bindings: {},
          errors: [],
        }),
      },
    },
  );
  const working = (await view.findByText("Working chat")).closest("a")!;
  const done = (await view.findByText("Done chat")).closest("a")!;
  expect(
    working.firstElementChild?.querySelector('[data-icon="Spinner"]'),
  ).not.toBeNull();
  expect(
    done.firstElementChild?.querySelector('[data-icon="CircleCheck"]'),
  ).not.toBeNull();
  expect(working.querySelector(".pf-status")?.textContent).toBe("");
  view.lifecycle.unmount();
});
