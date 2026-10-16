// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { installTestMatchMedia, setCompactViewport } from "./test-match-media";
import type { ProjectCategory } from "./project-categories";

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
  const categories: ProjectCategory[] = [
    { id: "c1", name: "Clients", color: "blue" },
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
      color?: string;
      projectId?: string;
    }) => {
      if (fail) throw new Error("Save unavailable");
      saved.push(input);
      const existing = categories.find((c) => c.id === input.id);
      const cat = {
        id: input.id ?? "new",
        name: input.name,
        color: input.color ?? existing?.color ?? "gray",
      };
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
              isUnread: true,
              indicator: "none",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              latestAttentionAt: Date.now(),
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
  const name = within(heading).getByText("Clients");
  expect(name.nextElementSibling?.getAttribute("data-icon")).toBe(
    "ChevronDown",
  );
  expect(name.nextElementSibling?.nextElementSibling?.textContent).toBe(
    "3 projects",
  );
  expect(within(group as HTMLElement).getByText("3 projects")).toBeTruthy();
  expect(within(heading.parentElement!).getAllByRole("button")).toHaveLength(1);
  expect(
    within(view.getByRole("button", { name: "Empty" })).getByText("0 projects"),
  ).toBeTruthy();
  expect(view.getAllByText("Alpha")).toHaveLength(1);
  fireEvent.click(heading);
  expect(name.nextElementSibling?.getAttribute("data-icon")).toBe(
    "ChevronRight",
  );
  expect(view.queryByRole("menuitem")).toBeNull();
  expect(view.queryByText("Alpha")).toBeNull();
  expect(view.queryByText("Beta")).toBeNull();
  expect(view.queryByText("Source-less")).toBeNull();
  expect(view.getByText("Gamma")).toBeTruthy();
  expect(view.getByText("No project")).toBeTruthy();
  expect(view.queryByText("No category")).toBeNull();
  expect(view.getByText("Personal chat")).toBeTruthy();
  view.lifecycle.unmount();
  const next = mount();
  await next.findByRole("button", { name: "Clients", expanded: false });
  expect(next.queryByText("Alpha")).toBeNull();
  fireEvent.click(next.getByRole("button", { name: "Clients" }));
  await next.findByText("Alpha");
  next.lifecycle.unmount();
});

it.each([false, true])(
  "omits the unassigned category label but keeps the personal heading and chats (compact %s)",
  async (compact) => {
    setCompactViewport(compact);
    const { view } = setup();
    await view.findByRole("button", { name: "Clients" });
    expect(view.queryByText("No category")).toBeNull();
    const personal = view.getByRole("button", {
      name: "No project",
      exact: true,
    });
    expect(personal.classList.contains("pf-category-toggle")).toBe(true);
    expect(personal.getAttribute("aria-expanded")).toBe("true");
    const personalName = within(personal).getByText("No project");
    expect(personalName.nextElementSibling?.getAttribute("data-icon")).toBe(
      "ChevronDown",
    );
    expect(
      view.queryByRole("button", { name: "Personal", exact: true }),
    ).toBeNull();
    const chat = view.getByRole("link", { name: /Personal chat/ });
    expect(chat.getAttribute("href")).toBe("#personal-chat");
    expect(
      chat.closest(".pf-project")?.querySelector(".pf-heading"),
    ).toBeTruthy();
    expect(view.getByText("Source-less")).toBeTruthy();
    expect(view.getByText("Gamma")).toBeTruthy();
    expect(
      view.getByRole("button", { name: "New chat", exact: true }),
    ).toBeTruthy();
    fireEvent.click(
      view.getByRole("button", { name: "No project", exact: true }),
    );
    expect(view.queryByText("Personal chat")).toBeNull();
    expect(personal.getAttribute("aria-expanded")).toBe("false");
    expect(personalName.nextElementSibling?.getAttribute("data-icon")).toBe(
      "ChevronRight",
    );
    fireEvent.click(
      view.getByRole("button", { name: "No project", exact: true }),
    );
    expect(view.getByText("Personal chat")).toBeTruthy();
  },
);

it.each([false, true])(
  "opens section management from an icon-only settings button (compact %s)",
  async (compact) => {
    setCompactViewport(compact);
    const { view } = setup();
    await view.findByRole("button", { name: "Clients" });
    const button = view.getByRole("button", { name: "Manage sections" });
    expect(button.textContent).toBe("");
    expect(button.getAttribute("title")).toBe("Manage sections");
    expect(button.querySelector('[data-icon="Settings"]')).toBeTruthy();
    fireEvent.click(button);
    expect(view.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "folders",
    });
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
  expect(saved).toContainEqual({
    name: "Hobby",
    projectId: "p3",
    color: "gray",
  });
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

it.each([false, true])(
  "saves a category color from its settings and keeps it after remount (compact %s)",
  async (compact) => {
    setCompactViewport(compact);
    const { view, saved, mount } = setup();
    const header = await view.findByRole("button", { name: "Clients" });
    expect(
      header.firstElementChild?.classList.contains("pf-category-mark"),
    ).toBe(true);
    fireEvent.contextMenu(header);
    fireEvent.click(
      await view.findByRole("menuitem", { name: "Settings", exact: true }),
    );
    const dialog = await view.findByRole("dialog", { name: "Settings" });
    const colors = within(dialog).getByRole("group", { name: "Color" });
    expect(
      within(colors)
        .getByRole("radio", { name: "blue", exact: true })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(
      within(colors).getByRole("radio", { name: "red", exact: true }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save", exact: true }),
    );
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(saved).toContainEqual({ id: "c1", name: "Clients", color: "red" });
    const color = (header.querySelector(".pf-category-mark") as HTMLElement)
      .style.backgroundColor;
    expect(color).toContain("0.62");
    expect(color).toContain("27");
    view.lifecycle.unmount();
    const next = mount();
    const nextHeader = await next.findByRole("button", { name: "Clients" });
    expect(
      (nextHeader.querySelector(".pf-category-mark") as HTMLElement).style
        .backgroundColor,
    ).toBe(color);
  },
);

it("saves a custom category color and keeps it when renaming", async () => {
  const { view, saved } = setup();
  const header = await view.findByRole("button", { name: "Clients" });
  fireEvent.contextMenu(header);
  fireEvent.click(
    await view.findByRole("menuitem", { name: "Settings", exact: true }),
  );
  const dialog = await view.findByRole("dialog", { name: "Settings" });
  fireEvent.change(within(dialog).getByLabelText("Custom color"), {
    target: { value: "#123456" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Save", exact: true }),
  );
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(saved).toContainEqual({ id: "c1", name: "Clients", color: "#123456" });
  const marker = header.querySelector(".pf-category-mark") as HTMLElement;
  expect(marker.style.backgroundColor).toBe("rgb(18, 52, 86)");
  fireEvent.contextMenu(header);
  fireEvent.click(
    await view.findByRole("menuitem", { name: "Rename", exact: true }),
  );
  fireEvent.change(
    await view.findByRole("textbox", { name: "Category name" }),
    { target: { value: "Renamed" } },
  );
  fireEvent.click(view.getByRole("button", { name: "Save", exact: true }));
  const renamed = await view.findByRole("button", { name: "Renamed" });
  expect(
    (renamed.querySelector(".pf-category-mark") as HTMLElement).style
      .backgroundColor,
  ).toBe("rgb(18, 52, 86)");
});

it("cancels category color edits without changing the marker", async () => {
  const { view, saved } = setup();
  const header = await view.findByRole("button", { name: "Clients" });
  const before = header
    .querySelector(".pf-category-mark")!
    .getAttribute("style");
  fireEvent.contextMenu(header);
  fireEvent.click(
    await view.findByRole("menuitem", { name: "Settings", exact: true }),
  );
  const dialog = await view.findByRole("dialog", { name: "Settings" });
  fireEvent.change(within(dialog).getByLabelText("Custom color"), {
    target: { value: "#123456" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Cancel", exact: true }),
  );
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(saved).toEqual([]);
  expect(header.querySelector(".pf-category-mark")!.getAttribute("style")).toBe(
    before,
  );
});

it("keeps a failed custom category color save open with its draft", async () => {
  const { view } = setup({ fail: true });
  const header = await view.findByRole("button", { name: "Clients" });
  const before = header
    .querySelector(".pf-category-mark")!
    .getAttribute("style");
  fireEvent.contextMenu(header);
  fireEvent.click(
    await view.findByRole("menuitem", { name: "Settings", exact: true }),
  );
  const dialog = await view.findByRole("dialog", { name: "Settings" });
  const input = within(dialog).getByLabelText("Custom color");
  fireEvent.change(input, { target: { value: "#123456" } });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Save", exact: true }),
  );
  expect((await view.findByRole("alert")).textContent).toContain(
    "Save unavailable",
  );
  expect((input as HTMLInputElement).value).toBe("#123456");
  expect(header.querySelector(".pf-category-mark")!.getAttribute("style")).toBe(
    before,
  );
});
