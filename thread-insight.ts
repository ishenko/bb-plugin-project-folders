import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

/**
 * What the thread tooltip shows beyond its status: total tokens and an
 * approximate cost (read from the Hub plugin, which already prices turns),
 * and a one-line gist written by a fast, cheap model.
 *
 * Gists are generated lazily, on hover, and cached per thread. A cached gist
 * is shown at once even when the thread moved on; a fresh one is written in
 * the background and pushed to the open tooltip. A running thread is not
 * summarized: its gist would be stale before it arrived.
 */

export const DEFAULT_ORIGIN = "https://omniroute.fffq.uk";
export const modelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:@-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._:@-]*)*$/);
export const summarySettingsSchema = z.object({
  enabled: z.boolean(),
  model: modelIdSchema,
  reasoning: z.enum(["default", "none", "low", "medium", "high"]),
  origin: z.string().refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" ||
          url.hostname === "127.0.0.1" ||
          url.hostname === "localhost") &&
        url.origin === value
      );
    } catch {
      return false;
    }
  }),
  /** Env Catalog variable holding the OmniRoute key; empty uses the macOS keychain. */
  envCatalogKey: z.string().regex(/^([A-Za-z_][A-Za-z0-9_]*)?$/),
});
export type SummarySettings = z.infer<typeof summarySettingsSchema>;
export const defaultSummarySettings: SummarySettings = {
  enabled: true,
  model: "glm/glm-5.3-flash",
  reasoning: "none",
  origin: DEFAULT_ORIGIN,
  envCatalogKey: "",
};

export const threadInsightSchema = z.object({
  usage: z
    .object({ totalTokens: z.number(), usd: z.number().nullable() })
    .nullable(),
  summary: z
    .object({
      text: z.string(),
      /** The thread has moved on since; a fresh gist may be on its way. */
      stale: z.boolean(),
    })
    .nullable(),
  /** A gist is being written now; it arrives through the `insight` event. */
  pending: z.boolean(),
  /** Why no gist could be written, when it failed. */
  error: z.string().nullable(),
});
export type ThreadInsight = z.infer<typeof threadInsightSchema>;

type Message = { seq: number; role: "user" | "assistant"; text: string };

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b((?:api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*)["']?[^\s"'`,;]{6,}/gi,
];

/** Best-effort removal of token-shaped strings before text leaves the machine. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS)
    out = out.replace(pattern, (match, prefix?: unknown) =>
      typeof prefix === "string" && prefix !== match && match.startsWith(prefix)
        ? `${prefix}[REDACTED]`
        : "[REDACTED]",
    );
  return out;
}

const clip = (text: string, max: number) => {
  const flat = text.replace(/\n{3,}/g, "\n\n").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
};

/** The opening request and the latest exchange, which is what a gist needs. */
export function gistPrompt(title: string, messages: readonly Message[]) {
  const first = messages.find((m) => m.role === "user");
  const tail = messages.slice(-4).filter((m) => m !== first);
  const lines = [
    ...(first ? [`user: ${clip(redactSecrets(first.text), 1500)}`] : []),
    ...(first && tail.length && tail[0]!.seq > first.seq + 1 ? ["…"] : []),
    ...tail.map((m) => `${m.role}: ${clip(redactSecrets(m.text), 1200)}`),
  ];
  return [
    {
      role: "system" as const,
      content:
        "Ты пишешь очень краткую суть чата с ИИ-агентом для всплывающей подсказки. " +
        "Одно предложение, не длиннее 140 символов, на языке переписки: что делается и чем закончилось или на чём остановились. " +
        "Без вступлений, кавычек, markdown и слов «пользователь» и «агент».",
    },
    {
      role: "user" as const,
      content: `Название: ${title || "без названия"}\n\n${lines.join("\n\n")}`,
    },
  ];
}

/** The model's line, without think blocks, quotes or a runaway length. */
export function cleanGist(content: string): string {
  const text = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s"«“'`*]+|[\s"»”'`*]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= 220 ? text : `${text.slice(0, 219).trimEnd()}…`;
}

type Sdk = {
  threads: {
    timeline(args: {
      threadId: string;
      segmentLimit?: string;
      deferContent?: string;
    }): Promise<{ rows: readonly unknown[] }>;
  };
  plugins: {
    callRpc<T>(args: {
      pluginId: string;
      method: string;
      input?: never;
      outputSchema: z.ZodType<T>;
      signal?: AbortSignal;
    }): Promise<T>;
  };
};
type Db = {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): unknown;
  };
};

const usageSchema = z.object({
  thread: z.object({
    tokens: z.object({ total: z.number() }),
    usd: z.number().nullable(),
  }),
});

let keychainKey: string | undefined;
async function keychainApiKey(): Promise<string> {
  if (keychainKey) return keychainKey;
  if (process.platform !== "darwin")
    throw new Error("Укажите ключ OmniRoute в Env Catalog.");
  try {
    const { stdout } = await promisify(execFile)(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-s",
        "codex-omniroute",
        "-a",
        "omniroute.fffq.uk/client",
        "-w",
      ],
      { timeout: 10_000, maxBuffer: 16_384 },
    );
    keychainKey = stdout.trim() || undefined;
  } catch {
    /* reported below */
  }
  if (!keychainKey) throw new Error("Ключ OmniRoute не найден.");
  return keychainKey;
}

export function makeThreadInsights(deps: {
  sdk: () => Sdk;
  db: Db;
  settings: () => SummarySettings;
  publish: (threadId: string) => void;
  fetcher?: typeof fetch;
  apiKey?: () => Promise<string>;
}) {
  const { db } = deps;
  const USAGE_TTL_MS = 15_000;
  const usage = new Map<
    string,
    { at: number; value: Promise<ThreadInsight["usage"]> }
  >();
  const running = new Map<string, Promise<void>>();
  const errors = new Map<string, { message: string; at: number }>();
  // A failing model is not asked again on every hover.
  const RETRY_AFTER_MS = 60_000;
  let active = 0;
  const queue: (() => void)[] = [];
  const slot = async () => {
    if (active >= 2) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
  };
  const release = () => {
    active--;
    queue.shift()?.();
  };

  const usageOf = (threadId: string) => {
    const hit = usage.get(threadId);
    if (hit && Date.now() - hit.at < USAGE_TTL_MS) return hit.value;
    const value = deps
      .sdk()
      .plugins.callRpc({
        pluginId: "hub",
        method: "thread_usage",
        input: { threadId, rows: false } as never,
        outputSchema: usageSchema,
        signal: AbortSignal.timeout(8000),
      })
      .then((r) => ({ totalTokens: r.thread.tokens.total, usd: r.thread.usd }))
      // Without the Hub plugin there is simply no usage line.
      .catch(() => null);
    usage.set(threadId, { at: Date.now(), value });
    return value;
  };

  type Row = {
    hint: string;
    fingerprint: string;
    summary: string | null;
    model: string | null;
  };
  const stored = (threadId: string) =>
    db
      .prepare(
        "SELECT hint, fingerprint, summary, model FROM thread_summaries WHERE threadId=?",
      )
      .get(threadId) as Row | undefined;
  const store = (threadId: string, row: Row) =>
    db
      .prepare(
        "INSERT INTO thread_summaries (threadId, hint, fingerprint, summary, model, updatedAt) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(threadId) DO UPDATE SET hint=excluded.hint, fingerprint=excluded.fingerprint, summary=excluded.summary, model=excluded.model, updatedAt=excluded.updatedAt",
      )
      .run(
        threadId,
        row.hint,
        row.fingerprint,
        row.summary,
        row.model,
        Date.now(),
      );

  const readMessages = async (threadId: string): Promise<Message[]> => {
    const timeline = await deps.sdk().threads.timeline({
      threadId,
      segmentLimit: "40",
      deferContent: "false",
    });
    const out = new Map<number, Message>();
    for (const row of timeline.rows as {
      kind?: string;
      role?: string;
      messageSeq?: number | null;
      text?: string | null;
    }[]) {
      if (row.kind !== "conversation") continue;
      if (row.role !== "user" && row.role !== "assistant") continue;
      if (typeof row.messageSeq !== "number" || !row.text?.trim()) continue;
      out.set(row.messageSeq, {
        seq: row.messageSeq,
        role: row.role,
        text: row.text,
      });
    }
    return [...out.values()].sort((a, b) => a.seq - b.seq);
  };

  const complete = async (
    settings: SummarySettings,
    messages: ReturnType<typeof gistPrompt>,
  ) => {
    const key = deps.apiKey
      ? await deps.apiKey()
      : settings.envCatalogKey
        ? (
            await deps.sdk().plugins.callRpc({
              pluginId: "env-catalog",
              method: "env_get_value",
              input: { name: settings.envCatalogKey } as never,
              outputSchema: z.object({ value: z.string() }),
            })
          ).value
        : settings.origin === DEFAULT_ORIGIN
          ? await keychainApiKey()
          : (() => {
              throw new Error("Укажите ключ OmniRoute в Env Catalog.");
            })();
    const res = await (deps.fetcher ?? fetch)(
      `${settings.origin}/v1/chat/completions`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: settings.model,
          ...(settings.reasoning !== "default"
            ? { reasoning_effort: settings.reasoning }
            : {}),
          stream: false,
          max_tokens: 400,
          messages,
        }),
      },
    );
    if (!res.ok) throw new Error(`Модель ответила HTTP ${res.status}.`);
    const body = z
      .object({
        choices: z
          .array(
            z.object({
              message: z.object({ content: z.string().nullish() }),
            }),
          )
          .min(1),
      })
      .parse(await res.json());
    const text = cleanGist(body.choices[0]!.message.content ?? "");
    if (!text) throw new Error("Модель вернула пустой ответ.");
    return text;
  };

  const refresh = (threadId: string, title: string, hint: string) => {
    const current = running.get(threadId);
    if (current) return current;
    const job = (async () => {
      await slot();
      try {
        const settings = deps.settings();
        const messages = await readMessages(threadId);
        const last = messages.at(-1);
        const fingerprint = last ? `seq:${last.seq}` : "empty";
        const prev = stored(threadId);
        // Renames and reads move the hint without new messages: keep the gist.
        if (prev?.summary && prev.fingerprint === fingerprint) {
          store(threadId, { ...prev, hint });
          return;
        }
        if (!messages.length) return;
        const summary = await complete(settings, gistPrompt(title, messages));
        store(threadId, { hint, fingerprint, summary, model: settings.model });
        errors.delete(threadId);
      } catch (error) {
        errors.set(threadId, {
          message: error instanceof Error ? error.message : String(error),
          at: Date.now(),
        });
      } finally {
        release();
        running.delete(threadId);
        deps.publish(threadId);
      }
    })();
    running.set(threadId, job);
    return job;
  };

  return {
    async get(input: {
      threadId: string;
      title: string;
      /** Changes whenever the thread does; cheap to compare. */
      hint: string;
      working: boolean;
    }): Promise<ThreadInsight> {
      const settings = deps.settings();
      const row = stored(input.threadId);
      const fresh = !!row?.summary && row.hint === input.hint;
      let pending = running.has(input.threadId);
      const failed = errors.get(input.threadId);
      const backingOff = !!failed && Date.now() - failed.at < RETRY_AFTER_MS;
      if (
        settings.enabled &&
        !fresh &&
        !input.working &&
        !pending &&
        !backingOff
      ) {
        void refresh(input.threadId, input.title, input.hint);
        pending = true;
      }
      return {
        usage: await usageOf(input.threadId),
        summary:
          settings.enabled && row?.summary
            ? { text: row.summary, stale: !fresh }
            : null,
        pending: settings.enabled && pending,
        error: (!pending && errors.get(input.threadId)?.message) || null,
      };
    },
    /** For tests: wait for a background gist. */
    settle: (threadId: string) => running.get(threadId) ?? Promise.resolve(),
  };
}
