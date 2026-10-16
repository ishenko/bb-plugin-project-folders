// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it } from "vitest";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { installTestMatchMedia, setCompactViewport } from "./test-match-media";
import { defaultPrefs } from "./preferences";

let app: Awaited<ReturnType<typeof loadPluginApp>>;
beforeAll(async () => {
  installTestMatchMedia();
  app = await loadPluginApp(() => import("./app"));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  setCompactViewport(false);
});

function setup({
  count = 12,
  categorized = true,
  active = false,
  extraLists = false,
} = {}) {
  const roots = Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    projectId: `p${index + 1}`,
    name: `Project ${index + 1}`,
    hostId: "h1",
    path: `/p${index + 1}`,
    parentId: null,
    sort: index,
  }));
  const extraRoots = extraLists
    ? ["Other", "Unassigned"].flatMap((prefix) =>
        roots.map((root) => ({
          ...root,
          id: `${prefix}-${root.id}`,
          projectId: `${prefix}-${root.id}`,
          name: `${prefix} ${root.name}`,
          path: `/${prefix}${root.path}`,
        })),
      )
    : [];
  return renderSlot(
    app.threadLists[0]!,
    { activeThreadId: active ? "active-chat" : null, onNavigate() {} },
    {
      sidebarThreads: {
        threads: active
          ? ([
              {
                id: "active-chat",
                projectId: `p${count}`,
                title: "Current chat",
                isUnread: false,
                indicator: "none",
                createdAt: 1,
                updatedAt: 1,
                latestAttentionAt: 1,
              },
            ] as never)
          : [],
        projects: [
          { id: "personal", name: "Personal", isPersonal: true },
        ] as never,
      },
      rpc: {
        prefs_get: () => ({
          prefs: {
            ...defaultPrefs,
            chatList: {
              ...defaultPrefs.chatList,
              sortSectionsByActivity: false,
            },
          },
          items: {},
          stored: true,
        }),
        list: () => ({
          roots: [...roots, ...extraRoots],
          folders: [],
          bindings: {},
          places: {},
          errors: [],
          machines: [],
          categories: categorized
            ? [
                { id: "c1", name: "Clients" },
                ...(extraLists ? [{ id: "c2", name: "Other" }] : []),
              ]
            : [],
          projectCategories: categorized
            ? Object.fromEntries([
                ...roots.map((root) => [root.projectId, "c1"]),
                ...extraRoots
                  .filter((root) => root.id.startsWith("Other-"))
                  .map((root) => [root.projectId, "c2"]),
              ])
            : {},
        }),
      },
    },
  );
}

it("expands category and unassigned lists independently", async () => {
  const view = setup({ extraLists: true });
  const clients = within(
    (await view.findByRole("button", { name: "Clients" })).closest(
      ".pf-category",
    ) as HTMLElement,
  );
  const other = within(
    view
      .getByRole("button", { name: "Other" })
      .closest(".pf-category") as HTMLElement,
  );
  fireEvent.click(clients.getByRole("button", { name: "Show all (12)" }));
  expect(view.getByText("Project 12")).toBeTruthy();
  expect(view.queryByText("Other Project 12")).toBeNull();
  expect(view.queryByText("Unassigned Project 12")).toBeNull();
  fireEvent.click(other.getByRole("button", { name: "Show all (12)" }));
  expect(view.getByText("Other Project 12")).toBeTruthy();
  expect(view.queryByText("Unassigned Project 12")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Show all (12)" }));
  fireEvent.click(clients.getByRole("button", { name: "Show fewer" }));
  expect(view.queryByText("Project 12")).toBeNull();
  expect(view.getByText("Other Project 12")).toBeTruthy();
  expect(view.getByText("Unassigned Project 12")).toBeTruthy();
});

it.each([false, true])(
  "expands and reduces a category project list (compact %s)",
  async (compact) => {
    setCompactViewport(compact);
    const view = setup();
    const heading = await view.findByRole("button", { name: "Clients" });
    const group = within(heading.closest(".pf-category") as HTMLElement);
    expect(group.getByText("12 projects")).toBeTruthy();
    expect(group.getByText("Project 10")).toBeTruthy();
    expect(group.queryByText("Project 11")).toBeNull();
    fireEvent.click(
      group.getByRole("button", { name: "Show all (12)", expanded: false }),
    );
    expect(group.getByText("Project 11")).toBeTruthy();
    expect(group.getByText("Project 12")).toBeTruthy();
    fireEvent.click(heading);
    expect(view.queryByText("Project 12")).toBeNull();
    fireEvent.click(heading);
    expect(group.getByText("Project 12")).toBeTruthy();
    fireEvent.click(
      group.getByRole("button", { name: "Show fewer", expanded: true }),
    );
    expect(group.queryByText("Project 11")).toBeNull();
    expect(group.getByText("12 projects")).toBeTruthy();
    expect(view.getByText("No project")).toBeTruthy();
  },
);

it("limits unassigned projects without adding a category heading", async () => {
  const view = setup({ categorized: false });
  await view.findByText("Project 10");
  expect(view.queryByText("Project 11")).toBeNull();
  expect(view.queryByText("No category")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Show all (12)" }));
  expect(view.getByText("Project 12")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Show fewer" }));
  expect(view.queryByText("Project 12")).toBeNull();
  expect(view.getByText("No project")).toBeTruthy();
});

it.each([0, 10])("does not offer expansion for %s projects", async (count) => {
  const view = setup({ count });
  await view.findByRole("button", { name: "Clients" });
  expect(
    view.queryByRole("button", { name: /Show all|Show fewer/ }),
  ).toBeNull();
  if (count) expect(view.getByText("Project 10")).toBeTruthy();
});

it.each([false, true])(
  "keeps the active project visible beyond the limit (categorized %s)",
  async (categorized) => {
    const view = setup({ categorized, active: true });
    await view.findByText("Project 12");
    expect(view.queryByText("Project 11")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Show all (12)" }));
    expect(view.getByText("Project 11")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Show fewer" }));
    expect(view.getByText("Project 12")).toBeTruthy();
    expect(view.queryByText("Project 11")).toBeNull();
  },
);
