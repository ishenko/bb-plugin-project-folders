import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { t } from "./i18n";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";

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

export function ThreadNotificationsDialog({
  threadId,
  title,
  parentThreadId,
  onClose,
}: {
  threadId: string;
  title: string;
  parentThreadId: string | null;
  onClose(): void;
}) {
  const sdk = useSdk();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<Own>("inherit");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null);
    setError("");
    void Promise.all([
      sdk.plugins.callRpc({
        pluginId,
        method: "threadNotifications.list",
        input: { threadIds: [threadId] },
        outputSchema: listSchema,
        signal: controller.signal,
      }),
      sdk.plugins.getSettings({ pluginId, signal: controller.signal }),
    ])
      .then(([result, settings]) => {
        if (controller.signal.aborted) return;
        const inputs = result.threads[threadId] ?? {
          own: "inherit" as const,
          ancestorCap: null,
        };
        const defaults = defaultsSchema.parse(settings.values);
        setLoaded({ inputs, defaults });
        setDraft(inputs.own);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => controller.abort();
  }, [sdk, threadId, attempt]);

  const fallback = loaded
    ? parentThreadId !== null && loaded.defaults.childLevel !== "inherit"
      ? loaded.defaults.childLevel
      : loaded.defaults.defaultLevel
    : null;
  const base = draft === "inherit" ? fallback : draft;
  const cap = loaded?.inputs.ancestorCap;
  const limited = base !== null && cap && rank[cap.level] < rank[base];
  const effective = limited ? cap.level : base;
  async function save() {
    if (!loaded || saving) return;
    setSaving(true);
    setError("");
    try {
      await sdk.plugins.callRpc({
        pluginId,
        method: "threadNotifications.set",
        input: { threadId, level: draft },
        outputSchema: inputsSchema,
      });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("Уведомления")}</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        {!loaded && !error && <p role="status">{t("Загрузка…")}</p>}
        {loaded && (
          <fieldset className="grid gap-2" disabled={saving}>
            <legend className="sr-only">{t("Уведомления")}</legend>
            {ownSchema.options.map((level) => (
              <label
                key={level}
                className="flex items-center gap-2 py-1 text-sm"
              >
                <input
                  type="radio"
                  name={`notifications-${threadId}`}
                  value={level}
                  checked={draft === level}
                  onChange={() => setDraft(level)}
                />
                {label(level)}
                {level === "inherit" && fallback && ` (${label(fallback)})`}
              </label>
            ))}
          </fieldset>
        )}
        {limited && effective && (
          <p role="status" className="text-sm text-muted-foreground">
            {cap.threadId === parentThreadId
              ? t("Ограничено родительским тредом")
              : t("Ограничено вышестоящим тредом")}
            {": "}
            {label(effective)}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive break-words">
            {error}
          </p>
        )}
        <DialogFooter>
          {!loaded && error && (
            <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              {t("Повторить")}
            </Button>
          )}
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {t("Отмена")}
          </Button>
          <Button
            disabled={!loaded || saving || draft === loaded.inputs.own}
            onClick={() => void save()}
          >
            {saving ? t("Сохраняю…") : t("Сохранить")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
