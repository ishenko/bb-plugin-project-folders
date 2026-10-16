import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { parseBackup } from "./backup";

const projects = [
  { id: "p1", name: "One", sources: [] },
  { id: "p2", name: "Two", sources: [] },
  { id: "personal", name: "Personal", kind: "personal", sources: [] },
];
const hosts: Awaited<ReturnType<typeof setup>>[] = [];
async function setup({ legacy = false } = {}) {
  const h = createFakePluginHost({
    pluginId: "project-folders",
    agentSkillIds: ["project-folders"],
    sdk: {
      projects: { list: async () => projects as never },
      hosts: { list: async () => [] },
      environments: { list: async () => [] },
    },
  });
  // Seed the schema from before category colors to exercise the reload migration.
  await plugin(
    legacy
      ? {
          ...h.bb,
          storage: {
            ...h.bb.storage,
            migrate(database, statements) {
              h.bb.storage.migrate(database, statements.slice(0, -1));
            },
          },
        }
      : h.bb,
  );
  hosts.push(h);
  return h;
}
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.harness.lifecycle.dispose();
});
type State = {
  categories: { id: string; name: string }[];
  projectCategories: Record<string, string>;
};

describe("project categories", () => {
  it("migrates existing categories in place without losing assignments", async () => {
    const h = await setup({ legacy: true });
    const db = h.bb.storage.database();
    db.prepare(
      "INSERT INTO project_categories (id, name, sort) VALUES (?, ?, ?)",
    ).run("old", "Existing", 7);
    db.prepare(
      "INSERT INTO project_category_assignments (projectId, categoryId) VALUES (?, ?)",
    ).run("p1", "old");
    Object.assign(h, await h.harness.lifecycle.reload(plugin));
    expect(await h.harness.behavior.callRpc("list", null)).toMatchObject({
      categories: [{ id: "old", name: "Existing", color: "gray" }],
      projectCategories: { p1: "old" },
    });
    expect(
      h.bb.storage
        .database()
        .prepare("SELECT sort FROM project_categories WHERE id=?")
        .get("old"),
    ).toEqual({ sort: 7 });
  });

  it("persists palette and custom colors without losing them on legacy renames", async () => {
    const h = await setup();
    const call = h.harness.behavior.callRpc;
    const category = (await call("category_save", {
      name: "Work",
      color: "teal",
    })) as { id: string };
    expect(
      await call("category_save", { id: category.id, name: "Clients" }),
    ).toMatchObject({ color: "teal" });
    await call("category_save", {
      id: category.id,
      name: "Clients",
      color: "#123456",
    });
    Object.assign(h, await h.harness.lifecycle.reload(plugin));
    expect(await h.harness.behavior.callRpc("list", null)).toMatchObject({
      categories: [{ id: category.id, name: "Clients", color: "#123456" }],
    });
    const backup = parseBackup(
      await h.harness.behavior.callRpc("backup_export", null),
    );
    const fresh = await setup();
    await fresh.harness.behavior.callRpc("backup_import", { backup });
    expect(await fresh.harness.behavior.callRpc("list", null)).toMatchObject({
      categories: [{ id: category.id, name: "Clients", color: "#123456" }],
    });
    for (const row of backup.tables.project_categories) delete row.color;
    await fresh.harness.behavior.callRpc("backup_import", { backup });
    expect(await fresh.harness.behavior.callRpc("list", null)).toMatchObject({
      categories: [{ id: category.id, name: "Clients", color: "gray" }],
    });
  });

  it("rejects invalid category colors without modifying saved categories", async () => {
    const h = await setup();
    const call = h.harness.behavior.callRpc;
    const category = (await call("category_save", {
      name: "Work",
      color: "blue",
    })) as { id: string };
    for (const color of [
      "",
      "#123",
      "red; color:black",
      "url(https://example.com)",
      "not-a-color",
    ]) {
      await expect(
        call("category_save", { id: category.id, name: "Work", color }),
      ).rejects.toThrow();
    }
    expect(await call("list", null)).toMatchObject({
      categories: [{ id: category.id, color: "blue" }],
    });
  });

  it("persists named categories and one assignment per project across reload", async () => {
    const h = await setup();
    const call = h.harness.behavior.callRpc;
    expect(await call("list", null)).toMatchObject({
      categories: [],
      projectCategories: {},
    });
    const work = (await call("category_save", {
      name: " Work ",
      projectId: "p1",
    })) as { id: string };
    const own = (await call("category_save", { name: "Personal" })) as {
      id: string;
    };
    await call("category_save", { id: work.id, name: "Clients" });
    await call("project_category_set", {
      projectId: "p2",
      categoryId: work.id,
    });
    await call("project_category_set", { projectId: "p1", categoryId: own.id });
    Object.assign(h, await h.harness.lifecycle.reload(plugin));
    expect(await h.harness.behavior.callRpc("list", null)).toMatchObject({
      categories: [
        { id: work.id, name: "Clients" },
        { id: own.id, name: "Personal" },
      ],
      projectCategories: { p1: own.id, p2: work.id },
    });
  });

  it("unassigns and deletes categories without touching projects or other plugin state", async () => {
    const h = await setup();
    const call = h.harness.behavior.callRpc;
    h.bb.storage
      .database()
      .prepare(
        "INSERT INTO folders (id, projectId, hostId, parentId, name, path) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("f1", "p1", "h1", null, "Section", "/work/section");
    const cat = (await call("category_save", {
      name: "Work",
      projectId: "p1",
    })) as { id: string };
    await call("project_category_set", { projectId: "p2", categoryId: cat.id });
    const before = parseBackup(await call("backup_export", null));
    await call("project_category_set", { projectId: "p1", categoryId: null });
    expect(((await call("list", null)) as State).projectCategories).toEqual({
      p2: cat.id,
    });
    await call("category_delete", { id: cat.id });
    expect(await call("list", null)).toMatchObject({
      categories: [],
      projectCategories: {},
    });
    const after = parseBackup(await call("backup_export", null));
    for (const [table, rows] of Object.entries(before.tables)) {
      if (!table.startsWith("project_categor"))
        expect(after.tables[table as keyof typeof after.tables]).toEqual(rows);
    }
    expect(h.harness.inspection.sdk.callsTo("projects.delete")).toHaveLength(0);
  });

  it("rejects invalid names, duplicates and unknown IDs without partial creation", async () => {
    const h = await setup();
    const call = h.harness.behavior.callRpc;
    const cat = (await call("category_save", { name: "Work" })) as {
      id: string;
    };
    for (const name of [" ", "x".repeat(81), "Bad\nName", "work"]) {
      await expect(call("category_save", { name })).rejects.toThrow();
    }
    await expect(
      call("category_save", { id: "missing", name: "Renamed" }),
    ).rejects.toThrow(/not found/i);
    await expect(
      call("project_category_set", { projectId: "p1", categoryId: "missing" }),
    ).rejects.toThrow(/not found/i);
    for (const projectId of ["missing", "personal"]) {
      await expect(
        call("category_save", { name: "Bad project", projectId }),
      ).rejects.toThrow();
      await expect(
        call("project_category_set", { projectId, categoryId: cat.id }),
      ).rejects.toThrow();
    }
    expect(await call("list", null)).toMatchObject({
      categories: [{ id: cat.id, name: "Work" }],
      projectCategories: {},
    });
  });

  it("round-trips categories through full backups and accepts old backups", async () => {
    const h = await setup();
    const call = h.harness.behavior.callRpc;
    const cat = (await call("category_save", {
      name: "Work",
      projectId: "p1",
    })) as { id: string };
    const backup = parseBackup(await call("backup_export", null));
    const fresh = await setup();
    await fresh.harness.behavior.callRpc("backup_import", { backup });
    expect(await fresh.harness.behavior.callRpc("list", null)).toMatchObject({
      categories: [{ id: cat.id, name: "Work" }],
      projectCategories: { p1: cat.id },
    });
    const old = structuredClone(backup) as { tables: Record<string, unknown> };
    delete old.tables.project_categories;
    delete old.tables.project_category_assignments;
    await fresh.harness.behavior.callRpc("backup_import", { backup: old });
    expect(await fresh.harness.behavior.callRpc("list", null)).toMatchObject({
      categories: [],
      projectCategories: {},
    });
  });
});
