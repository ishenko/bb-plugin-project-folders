import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  Content as TooltipContent,
  Portal as TooltipPortal,
  Provider as TooltipProvider,
  Root as Tooltip,
  Trigger as TooltipTrigger,
} from "@radix-ui/react-tooltip";
import {
  useRealtime,
  useRpc,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { ThreadInsight } from "./thread-insight";
import { threadState, type ThreadState } from "./thread-status";
import { t, useLanguage } from "./i18n";

const STATE_LABELS: Record<ThreadState, () => string> = {
  waiting: () => t("Ждёт ответа"),
  working: () => t("Работает"),
  error: () => t("Ошибка"),
  idle: () => t("В очереди"),
  done: () => t("Готово · новый ответ"),
  read: () => t("Готово"),
};

// Shared across rows: hovering back to a chat shows its last answer at once.
const cache = new Map<string, { hint: string; value: ThreadInsight }>();

/** "1,2 млн токенов", "843 токена": compact numbers, words that agree with them. */
export function formatTokens(count: number, language: string): string {
  const number = new Intl.NumberFormat(language, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(count);
  if (language !== "ru") return `${number} ${t("токенов")}`;
  if (count >= 1000) return `${number} токенов`;
  const form = new Intl.PluralRules("ru").select(count);
  return `${number} ${form === "one" ? "токен" : form === "few" ? "токена" : "токенов"}`;
}

/** Hub's rounding: whole dollars from $100, cents from $1, tenths of a cent below. */
export function formatUsd(usd: number): string {
  return usd >= 100
    ? `$${usd.toFixed(0)}`
    : usd >= 1
      ? `$${usd.toFixed(2)}`
      : `$${usd.toFixed(3)}`;
}

type TipThread = Pick<
  PluginSidebarThread,
  | "id"
  | "title"
  | "titleFallback"
  | "indicator"
  | "indicatorLabel"
  | "hasPendingInteraction"
  | "isUnread"
  | "isPinned"
  | "status"
  | "runtimeStatus"
  | "queuedWork"
> & { updatedAt?: number };

function TipBody({ thread }: { thread: TipThread }) {
  const rpc = useRpc<typeof rpcContract>();
  const language = useLanguage();
  const state = threadState(thread);
  const hint = String(thread.updatedAt ?? "");
  const [info, setInfo] = useState<ThreadInsight | null>(
    () => cache.get(thread.id)?.value ?? null,
  );
  const load = useCallback(() => {
    rpc
      .call("thread_insight", {
        threadId: thread.id,
        title: (thread.title || thread.titleFallback || "").slice(0, 500),
        hint,
        working: state === "working",
      })
      .then(
        (value) => {
          cache.set(thread.id, { hint, value });
          setInfo(value);
        },
        () => {},
      );
  }, [rpc, thread.id, thread.title, thread.titleFallback, hint, state]);
  useEffect(load, [load]);
  useRealtime("insight", (payload) => {
    if ((payload as { threadId?: string } | null)?.threadId === thread.id)
      load();
  });
  const usage = info?.usage;
  return (
    <>
      <span className="pf-tooltip-line">
        <span className="pf-tip-state" data-thread-status={state}>
          {thread.indicatorLabel || STATE_LABELS[state]()}
        </span>
        {usage && usage.totalTokens > 0 && (
          <span className="pf-tooltip-meta">
            {formatTokens(usage.totalTokens, language)}
          </span>
        )}
        {usage?.usd != null && usage.usd > 0 && (
          <span className="pf-tooltip-meta">≈ {formatUsd(usage.usd)}</span>
        )}
      </span>
      {info?.summary ? (
        <span
          className={
            "pf-tip-summary" + (info.summary.stale ? " pf-tip-stale" : "")
          }
        >
          {info.summary.text}
        </span>
      ) : info?.pending ? (
        <span className="pf-tip-summary pf-tip-stale">
          {t("Пишу краткую суть…")}
        </span>
      ) : null}
    </>
  );
}

/** Status, tokens, cost and a one-line gist when hovering a chat. */
export function ThreadTip({
  thread,
  children,
}: {
  thread: TipThread;
  children: ReactElement;
}) {
  return (
    <TooltipProvider delayDuration={600}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipPortal>
          <TooltipContent
            className="pf-tooltip pf-tooltip-stack pf-tip"
            side="bottom"
            align="start"
            sideOffset={2}
            collisionPadding={8}
          >
            <TipBody thread={thread} />
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
}
