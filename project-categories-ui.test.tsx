// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { installTestMatchMedia, setCompactViewport } from "./test-match-media";

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
const root = {
  id: "p1",
  projectId: "p1",
  name: "Alpha",
  hostId: "h1",
  path: "/a",
  parentId: null,
};
const beta = { ...root, id: "p2", projectId: "p2", name: "Beta", path: "/b" };
const gamma = { ...root, id: "p3", projectId: "p3", name: "Gamma", path: "/c" };
function setup({ fail = false, stale = false } = {}) {
  const categories = [
    { id: "c1", name: "Clients" },
    { id: "c2", name: "Empty" },
  ];
  const projectCategories: Record<string, string> = {
    p1: stale ? "missing" : "c1",
    p2: "c1",
    remote: "c1",
  };
  const saved: unknown[] = [];
  const rpc = {
    list: () => ({
      roots: [root, { ...root, hostId: "h2" }, beta, gamma],
      folders: [],
      bindings: {},
      places: {},
      errors: [],
      machines: [],
      categories,
      projectCategories,
    }),
    category_save: (input: {
      id?: string;
      name: string;
      projectId?: string;
    }) => {
      if (fail) throw new Error("Save unavailable");
      saved.push(input);
      const cat = { id: input.id ?? "new", name: input.name };
      const existing = categories.find((c) => c.id === cat.id);
      if (existing) Object.assign(existing, cat);
      else categories.push(cat);
      if (input.projectId) projectCategories[input.projectId] = cat.id;
      return cat;
    },
    project_category_set: (input: {
      projectId: string;
      categoryId: string | null;
    }) => {
      saved.push(input);
      if (input.categoryId)
        projectCategories[input.projectId] = input.categoryId;
      else delete projectCategories[input.projectId];
      return { ok: true };
    },
    category_delete: ({ id }: { id: string }) => {
      categories.splice(
        categories.findIndex((c) => c.id === id),
        1,
      );
      for (const [p, c] of Object.entries(projectCategories))
        if (c === id) delete projectCategories[p];
      return { ok: true };
    },
  };
  const mount = () =>
    renderSlot(
      app.threadLists[0]!,
      { activeThreadId: null, onNavigate() {} },
      {
        sidebarThreads: {
          threads: [
            {
              id: "personal-chat",
              projectId: "personal",
              title: "Personal chat",
            },
          ] as never,
          projects: [
            { id: "remote", name: "Source-less", isPersonal: false },
            { id: "personal", name: "Personal", isPersonal: true },
          ] as never,
        },
        rpc,
      },
    );
  return { view: mount(), mount, saved };
}

it("groups projects once, counts source-less projects and remembers category collapse", async () => {
  const { view, mount } = setup();
  const heading = await view.findByRole("button", {
    name: "Clients",
    expanded: true,
  });
  const group = heading.closest(".pf-category")!;
  expect(within(group as HTMLElement).getByText("3 projects")).toBeTruthy();
  expect(within(heading.parentElement!).getAllByRole("button")).toHaveLength(1);
  expect(
    within(view.getByRole("button", { name: "Empty" })).getByText("0 projects"),
  ).toBeTruthy();
  expect(view.getAllByText("Alpha")).toHaveLength(1);
  fireEvent.click(heading);
  expect(view.queryByRole("menuitem")).toBeNull();
  expect(view.queryByText("Alpha")).toBeNull();
  expect(view.queryByText("Beta")).toBeNull();
  expect(view.queryByText("Source-less")).toBeNull();
  expect(view.getByText("Gamma")).toBeTruthy();
  expect(view.queryByText("No project")).toBeNull();
  view.lifecycle.unmount();
  const next = mount();
  await next.findByRole("button", { name: "Clients", expanded: false });
  expect(next.queryByText("Alpha")).toBeNull();
  fireEvent.click(next.getByRole("button", { name: "Clients" }));
  await next.findByText("Alpha");
  next.lifecycle.unmount();
});

it.each([false, true])(
  "hides the personal section without hiding source-less projects (compact %s)",
  async (compact) => {
    setCompactViewport(compact);
    const { view } = setup();
    await view.findByRole("button", { name: "Clients" });
    expect(
      view.queryByRole("button", { name: "No project", exact: true }),
    ).toBeNull();
    expect(
      view.queryByRole("button", { name: "Personal", exact: true }),
    ).toBeNull();
    expect(view.queryByText("Personal chat")).toBeNull();
    expect(view.getByText("Source-less")).toBeTruthy();
    expect(view.getByText("Gamma")).toBeTruthy();
    expect(
      view.getByRole("button", { name: "New chat", exact: true }),
    ).toBeTruthy();
  },
);

it.each([false, true])(
  "opens category actions without toggling (compact %s)",
  async (compact) => {
    setCompactViewport(compact);
    const { view } = setup();
    const heading = await view.findByRole("button", {
      name: "Clients",
      expanded: true,
    });
    fireEvent.contextMenu(heading);
    expect(await view.findByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(heading.getAttribute("aria-expanded")).toBe("true");
  },
);

it.each(["ContextMenu", "F10"])(
  "opens category actions with %s",
  async (key) => {
    const { view } = setup();
    const heading = await view.findByRole("button", { name: "Clients" });
    fireEvent.keyDown(heading, { key, shiftKey: key === "F10" });
    expect(await view.findByRole("menuitem", { name: "Rename" })).toBeTruthy();
  },
);

it.each([false, true])(
  "toggles categories with the keyboard without opening actions (compact %s)",
  async (compact) => {
    setCompactViewport(compact);
    const { view } = setup();
    const heading = await view.findByRole("button", {
      name: "Clients",
      expanded: true,
    });
    fireEvent.keyDown(heading, { key: "Enter" });
    expect(heading.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(heading, { key: " " });
    expect(heading.getAttribute("aria-expanded")).toBe("true");
    expect(view.queryByRole("menuitem")).toBeNull();
  },
);

it("does not hide a project whose category disappeared", async () => {
  const { view } = setup({ stale: true });
  const alpha = await view.findByText("Alpha");
  expect(alpha.closest(".pf-category")).toBeNull();
  expect(
    view.getByRole("button", { name: "Empty", expanded: true }),
  ).toBeTruthy();
});

it("localizes project counts with Russian plural forms", async () => {
  localStorage.setItem("project-folders:language", "ru");
  const { view } = setup();
  const heading = await view.findByRole("button", { name: "Clients" });
  expect(within(heading).getByText("3 проекта")).toBeTruthy();
  expect(
    within(view.getByRole("button", { name: "Empty" })).getByText("0 проектов"),
  ).toBeTruthy();
});

it("shows no category for a stale assignment in the picker", async () => {
  const { view, saved } = setup({ stale: true });
  fireEvent.contextMenu(await view.findByText("Alpha"));
  fireEvent.click(await view.findByRole("menuitem", { name: "Category" }));
  expect(
    (
      (await view.findByRole("combobox", {
        name: "Category",
      })) as HTMLSelectElement
    ).value,
  ).toBe("");
  fireEvent.click(view.getByRole("button", { name: "Save", exact: true }));
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(saved).toEqual([{ projectId: "p1", categoryId: null }]);
});

it.each([false, true])(
  "assigns a source-less project through its menu (compact %s)",
  async (compact) => {
    setCompactViewport(compact);
    const { view, saved } = setup();
    await view.findByRole("button", { name: "Clients" });
    fireEvent.contextMenu(await view.findByText("Source-less"));
    fireEvent.click(await view.findByRole("menuitem", { name: "Category" }));
    const select = await view.findByRole("combobox", { name: "Category" });
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(view.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() =>
      expect(saved).toEqual([{ projectId: "remote", categoryId: null }]),
    );
    await waitFor(() =>
      expect(view.getByText("Source-less").closest(".pf-category")).toBeNull(),
    );
  },
);

it("creates and assigns a category from the project menu, then renames and deletes it", async () => {
  const { view, saved } = setup();
  fireEvent.contextMenu(await view.findByText("Gamma"));
  fireEvent.click(await view.findByRole("menuitem", { name: "Category" }));
  fireEvent.click(await view.findByRole("button", { name: "New category" }));
  fireEvent.change(view.getByRole("textbox", { name: "Category name" }), {
    target: { value: "Hobby" },
  });
  fireEvent.click(view.getByRole("button", { name: "Save", exact: true }));
  await view.findByRole("button", { name: "Hobby" });
  expect(saved).toContainEqual({ name: "Hobby", projectId: "p3" });
  fireEvent.contextMenu(view.getByRole("button", { name: "Hobby" }));
  fireEvent.click(await view.findByRole("menuitem", { name: "Rename" }));
  fireEvent.change(
    await view.findByRole("textbox", { name: "Category name" }),
    { target: { value: "Games" } },
  );
  fireEvent.click(view.getByRole("button", { name: "Save", exact: true }));
  await view.findByRole("button", { name: "Games" });
  fireEvent.contextMenu(view.getByRole("button", { name: "Games" }));
  fireEvent.click(
    await view.findByRole("menuitem", { name: "Delete category" }),
  );
  fireEvent.click(await view.findByRole("button", { name: "Yes, delete" }));
  await waitFor(() =>
    expect(view.queryByRole("button", { name: "Games" })).toBeNull(),
  );
  expect(view.getByText("Gamma").closest(".pf-category")).toBeNull();
});

it("keeps a failed category save open with the draft and error", async () => {
  const { view } = setup({ fail: true });
  fireEvent.contextMenu(await view.findByText("Alpha"));
  fireEvent.click(await view.findByRole("menuitem", { name: "Category" }));
  fireEvent.click(await view.findByRole("button", { name: "New category" }));
  fireEvent.change(view.getByRole("textbox", { name: "Category name" }), {
    target: { value: "Retry me" },
  });
  fireEvent.click(view.getByRole("button", { name: "Save", exact: true }));
  expect((await view.findByRole("alert")).textContent).toContain(
    "Save unavailable",
  );
  expect(
    (view.getByRole("textbox", { name: "Category name" }) as HTMLInputElement)
      .value,
  ).toBe("Retry me");
  expect(view.getByRole("dialog")).toBeTruthy();
});
