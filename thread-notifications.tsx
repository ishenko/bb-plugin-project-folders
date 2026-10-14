import { useEffect, useRef, useState } from "react";
import { experimental_Icon as BbIcon, useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { t } from "./i18n";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "./components/ui/dropdown-menu";
import { useIsCompactViewport } from "./components/ui/hooks/use-compact-viewport";

const pluginId = "push-notifications";
const levelSchema = z.enum(["all", "input-only", "muted"]);
const ownSchema = z.enum(["inherit", "all", "input-only", "muted"]);
const inputsSchema = z.object({
  own: ownSchema,
  ancestorCap: z
    .object({ level: levelSchema, threadId: z.string().min(1) })
    .nullable(),
});
const listSchema = z.object({ threads: z.record(z.string(), inputsSchema) });
const defaultsSchema = z.object({
  defaultLevel: levelSchema,
  childLevel: ownSchema,
});
type Level = z.infer<typeof levelSchema>;
type Own = z.infer<typeof ownSchema>;
type Loaded = {
  inputs: z.infer<typeof inputsSchema>;
  defaults: z.infer<typeof defaultsSchema>;
};
const rank: Record<Level, number> = { muted: 0, "input-only": 1, all: 2 };
const label = (level: Own) =>
  ({
    inherit: t("По умолчанию"),
    all: t("Все события"),
    "input-only": t("Только запросы ввода"),
    muted: t("Без уведомлений"),
  })[level];

export function ThreadNotificationsMenu({
  threadId,
  parentThreadId,
  open,
  compactStep,
  onStepChange,
  onClose,
}: {
  threadId: string;
  parentThreadId: string | null;
  open: boolean;
  compactStep: boolean;
  onStepChange(open: boolean): void;
  onClose(): void;
}) {
  const sdk = useSdk();
  const compact = useIsCompactViewport();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoaded(null);
    setError("");
    void Promise.resolve()
      .then(() =>
        Promise.all([
          sdk.plugins.callRpc({
            pluginId,
            method: "threadNotifications.list",
            input: { threadIds: [threadId] },
            outputSchema: listSchema,
            signal: controller.signal,
          }),
          sdk.plugins.getSettings({ pluginId, signal: controller.signal }),
        ]),
      )
      .then(([result, settings]) => {
        if (controller.signal.aborted) return;
        const inputs = result.threads[threadId] ?? {
          own: "inherit" as const,
          ancestorCap: null,
        };
        const defaults = defaultsSchema.parse(settings.values);
        setLoaded({ inputs, defaults });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => controller.abort();
  }, [sdk, threadId, open, attempt]);

  const fallback = loaded
    ? parentThreadId !== null && loaded.defaults.childLevel !== "inherit"
      ? loaded.defaults.childLevel
      : loaded.defaults.defaultLevel
    : null;
  const base = loaded?.inputs.own === "inherit" ? fallback : loaded?.inputs.own;
  const cap = loaded?.inputs.ancestorCap;
  const limited = base != null && cap && rank[cap.level] < rank[base];
  const effective = limited ? cap.level : base;
  const detail = effective
    ? label(effective)
    : error
      ? t("Повторить")
      : t("Загрузка…");
  async function save(level: Own) {
    if (!loaded || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const inputs = await sdk.plugins.callRpc({
        pluginId,
        method: "threadNotifications.set",
        input: { threadId, level },
        outputSchema: inputsSchema,
      });
      setLoaded({ ...loaded, inputs });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  const summary = (
    <>
      <BbIcon
        name={
          effective === "muted"
            ? "push-notifications/off"
            : effective === "all"
              ? "push-notifications/ringing"
              : "BellDot"
        }
        fallback="BellDot"
        className="size-4 shrink-0"
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{t("Уведомления")}</span>
        <span className="truncate text-2xs text-muted-foreground">
          {detail}
        </span>
      </span>
    </>
  );
  const choices = (
    <>
      {ownSchema.options.map((level) => (
        <DropdownMenuItem
          key={level}
          role={compact ? "menuitemradio" : "menuitem"}
          aria-checked={compact ? loaded?.inputs.own === level : undefined}
          aria-current={loaded?.inputs.own === level ? "true" : undefined}
          className="flex items-center justify-between gap-3"
          disabled={!loaded || saving}
          onSelect={(event) => {
            event.preventDefault();
            void save(level);
          }}
        >
          <span className="min-w-0 flex-1 truncate">
            {label(level)}
            {level === "inherit" && fallback && ` (${label(fallback)})`}
          </span>
          {loaded?.inputs.own === level && (
            <BbIcon
              name="Check"
              className="ml-auto size-4 shrink-0"
              aria-hidden="true"
            />
          )}
        </DropdownMenuItem>
      ))}
      {limited && (
        <>
          <DropdownMenuSeparator />
          <div className="max-w-56 px-2 py-1 text-xs text-muted-foreground">
            {cap.threadId === parentThreadId
              ? t("Ограничено родительским тредом")
              : t("Ограничено вышестоящим тредом")}
          </div>
        </>
      )}
      {saving && (
        <div role="status" className="px-2 py-1 text-xs text-muted-foreground">
          {t("Сохраняю…")}
        </div>
      )}
      {error && (
        <>
          <DropdownMenuSeparator />
          <div
            role="alert"
            className="max-w-56 break-words px-2 py-1 text-xs text-destructive"
          >
            {error}
          </div>
          {!loaded && (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setAttempt((n) => n + 1);
              }}
            >
              {t("Повторить")}
            </DropdownMenuItem>
          )}
        </>
      )}
    </>
  );
  if (compact) {
    return compactStep ? (
      <>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onStepChange(false);
          }}
        >
          <BbIcon name="ChevronLeft" className="size-4" aria-hidden="true" />
          {t("Назад")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("Уведомления")}</DropdownMenuLabel>
        {choices}
      </>
    ) : (
      <DropdownMenuItem
        aria-label={`${t("Уведомления")} ${detail}`}
        onSelect={(event) => {
          event.preventDefault();
          onStepChange(true);
        }}
      >
        {summary}
        <BbIcon
          name="ChevronRight"
          className="ml-auto size-4"
          aria-hidden="true"
        />
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger aria-label={`${t("Уведомления")} ${detail}`}>
        {summary}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[min(24rem,calc(100vh-2rem))] min-w-44 overflow-y-auto">
        {choices}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
