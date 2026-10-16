// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it } from "vitest";
import { cleanup, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { installTestMatchMedia } from "./test-match-media";
import { defaultPrefs } from "./preferences";

let app: Awaited<ReturnType<typeof loadPluginApp>>;
beforeAll(async () => {
  installTestMatchMedia();
  app = await loadPluginApp(() => import("./app"));
});
afterEach(cleanup);

it("excludes hidden projects and duplicate device roots from category counts", async () => {
  const root = {
    id: "p1",
    projectId: "p1",
    name: "Visible",
    hostId: "h1",
    path: "/a",
    parentId: null,
  };
  const view = renderSlot(
    app.threadLists[0]!,
    { activeThreadId: null, onNavigate() {} },
    {
      sidebarThreads: { threads: [], projects: [] },
      rpc: {
        list: () => ({
          folders: [],
          roots: [
            root,
            { ...root, hostId: "h2" },
            { ...root, id: "p2", projectId: "p2", name: "Hidden" },
          ],
          bindings: {},
          places: {},
          machines: [],
          errors: [],
          categories: [{ id: "c1", name: "Clients" }],
          projectCategories: { p1: "c1", p2: "c1" },
        }),
        prefs_get: () => ({
          prefs: defaultPrefs,
          items: { "p:p2": { hidden: true } },
          stored: true,
        }),
      },
    },
  );
  const header = await view.findByRole("button", { name: "Clients" });
  await waitFor(() => expect(view.queryByText("Hidden")).toBeNull());
  expect(view.getAllByText("Visible")).toHaveLength(1);
  expect(within(header).getByText("1 project")).toBeTruthy();
});
