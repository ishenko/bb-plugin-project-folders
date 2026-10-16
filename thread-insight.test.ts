import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { cleanGist, gistPrompt, redactSecrets } from "./thread-insight";

const root = {
  id: "p1",
  name: "Project",
  isPersonal: false,
  sources: [
    {
      id: "s1",
      type: "local_path",
      hostId: "h1",
      path: "/work",
      isDefault: true,
    },
  ],
};

describe("gist prompt", () => {
  it("keeps the opening request and the latest exchange, without secrets", () => {
    const messages = [
      { seq: 1, role: "user" as const, text: "Fix login, token=abcdef123456" },
      { seq: 2, role: "assistant" as const, text: "Looking" },
      { seq: 3, role: "user" as const, text: "more" },
      { seq: 4, role: "assistant" as const, text: "a" },
      { seq: 5, role: "user" as const, text: "b" },
      { seq: 6, role: "assistant" as const, text: "Done: fixed" },
    ];
    const [, user] = gistPrompt("Login", messages);
    expect(user!.content).toContain("user: Fix login, token=[REDACTED]");
    expect(user!.content).toContain("…");
    expect(user!.content).toContain("assistant: Done: fixed");
    expect(user!.content).not.toContain("Looking");
    expect(redactSecrets("ghp_abcdefghijklmnopqrstuvwxyz")).toBe("[REDACTED]");
  });
  it("cleans the model line", () => {
    expect(cleanGist("<think>x</think> «Чинит вход» ")).toBe("Чинит вход");
    expect(cleanGist("a".repeat(400))).toHaveLength(220);
  });
});

describe("thread_insight", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("returns usage from Hub, writes a gist once and reuses it", async () => {
    const calls: { pluginId: string; method: string }[] = [];
    const completions: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        completions.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Чинит вход и проверяет тесты" } }],
          }),
          { status: 200 },
        );
      }),
    );
    const h = createFakePluginHost({
      pluginId: "project-folders",
      agentSkillIds: ["project-folders"],
      sdk: {
        projects: { list: async () => [root] as never },
        hosts: { list: async () => [] as never },
        environments: { list: async () => [] },
        threads: {
          timeline: async () =>
            ({
              rows: [
                {
                  kind: "conversation",
                  role: "user",
                  messageSeq: 1,
                  text: "Почини вход",
                },
                {
                  kind: "conversation",
                  role: "assistant",
                  messageSeq: 2,
                  text: "Готово",
                },
              ],
            }) as never,
        },
        plugins: {
          callRpc: async (args: { pluginId: string; method: string }) => {
            calls.push({ pluginId: args.pluginId, method: args.method });
            if (args.pluginId === "hub")
              return { thread: { tokens: { total: 1234567 }, usd: 3.4 } };
            if (args.pluginId === "env-catalog") return { value: "key" };
            throw new Error("unexpected");
          },
        } as never,
      },
    });
    await plugin(h.bb);
    const call = h.harness.behavior.callRpc;
    try {
      await call("summary_settings_save", {
        enabled: true,
        model: "glm/glm-5.3-flash",
        reasoning: "none",
        origin: "https://omniroute.fffq.uk",
        envCatalogKey: "OMNI",
      });
      const input = {
        threadId: "t1",
        title: "Вход",
        hint: "100",
        working: false,
      };
      const first = (await call("thread_insight", input)) as {
        usage: unknown;
        summary: unknown;
        pending: boolean;
      };
      expect(first.usage).toEqual({ totalTokens: 1234567, usd: 3.4 });
      expect(first.summary).toBeNull();
      expect(first.pending).toBe(true);
      await vi.waitFor(async () => {
        const next = (await call("thread_insight", input)) as {
          summary: { text: string; stale: boolean } | null;
        };
        expect(next.summary).toEqual({
          text: "Чинит вход и проверяет тесты",
          stale: false,
        });
      });
      expect(completions).toHaveLength(1);
      expect((completions[0] as { model: string }).model).toBe(
        "glm/glm-5.3-flash",
      );
      // A new hint with the same last message keeps the gist without a model call.
      await call("thread_insight", { ...input, hint: "101" });
      await new Promise((r) => setTimeout(r, 30));
      const again = (await call("thread_insight", {
        ...input,
        hint: "101",
      })) as {
        summary: { stale: boolean } | null;
      };
      expect(again.summary?.stale).toBe(false);
      expect(completions).toHaveLength(1);
      // A running thread is not summarized.
      const running = (await call("thread_insight", {
        ...input,
        threadId: "t2",
        working: true,
      })) as { pending: boolean };
      expect(running.pending).toBe(false);
      expect(completions).toHaveLength(1);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
});
