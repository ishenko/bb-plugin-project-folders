import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { parseBackup } from "./backup";

async function setup() {
  const h = createFakePluginHost({
    pluginId: "project-folders",
    agentSkillIds: ["project-folders"],
    sdk: {
      projects: { list: async () => [] as never },
      hosts: { list: async () => [] as never },
      environments: { list: async () => [] },
    },
  });
  await plugin(h.bb);
  return h;
}
type TagsState = {
  tags: { id: string; name: string; color: string }[];
  assignments: Record<string, string>;
};

describe("chat labels", () => {
  it("creates, renames, orders and deletes labels; one label per chat", async () => {
    const h = await setup();
    const call = h.harness.behavior.callRpc;
    expect(await call("tags_get", null)).toEqual({ tags: [], assignments: {} });
    const bug = (await call("tag_save", { name: " Bug ", color: "red" })) as {
      id: string;
    };
    const idea = (await call("tag_save", {
      name: "Idea",
      color: "#00aa55",
    })) as { id: string };
    await call("tag_save", { id: bug.id, name: "Bugfix", color: "orange" });
    await call("thread_tag_set", { threadId: "t1", tagId: bug.id });
    await call("thread_tag_set", { threadId: "t1", tagId: idea.id });
    await call("thread_tag_set", { threadId: "t2", tagId: bug.id });
    await call("tag_reorder", { ids: [idea.id, bug.id] });
    let state = (await call("tags_get", null)) as TagsState;
    expect(state.tags).toEqual([
      { id: idea.id, name: "Idea", color: "#00aa55" },
      { id: bug.id, name: "Bugfix", color: "orange" },
    ]);
    expect(state.assignments).toEqual({ t1: idea.id, t2: bug.id });

    await call("thread_tag_set", { threadId: "t1", tagId: null });
    await call("tag_delete", { id: bug.id });
    state = (await call("tags_get", null)) as TagsState;
    expect(state.tags.map((t) => t.id)).toEqual([idea.id]);
    expect(state.assignments).toEqual({});
  });

  it("refuses an unknown label and an invalid color", async () => {
    const h = await setup();
    const call = h.harness.behavior.callRpc;
    await expect(
      call("thread_tag_set", { threadId: "t1", tagId: "missing" }),
    ).rejects.toThrow(/not found/i);
    await expect(
      call("tag_save", { name: "X", color: "javascript:1" }),
    ).rejects.toThrow();
  });

  it("travels in the plugin backup and accepts older backups without labels", async () => {
    const h = await setup();
    const call = h.harness.behavior.callRpc;
    const tag = (await call("tag_save", { name: "Ops", color: "blue" })) as {
      id: string;
    };
    await call("thread_tag_set", { threadId: "t9", tagId: tag.id });
    const backup = (await call("backup_export", null)) as {
      tables: Record<string, unknown[]>;
    };
    expect(backup.tables.thread_tags).toHaveLength(1);
    expect(backup.tables.thread_tag_assignments).toHaveLength(1);

    const fresh = await setup();
    const result = (await fresh.harness.behavior.callRpc("backup_import", {
      backup,
    })) as Record<string, number>;
    expect(result.thread_tags).toBe(1);
    expect(
      await fresh.harness.behavior.callRpc("tags_get", null),
    ).toMatchObject({ assignments: { t9: tag.id } });

    const old = structuredClone(backup);
    delete old.tables.thread_tags;
    delete old.tables.thread_tag_assignments;
    expect(parseBackup(old).tables.thread_tags).toEqual([]);
  });
});
