import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { Icon } from "./components/ui/icon";
import { t } from "./i18n";

type StatusThread = Pick<
  PluginSidebarThread,
  | "indicator"
  | "indicatorLabel"
  | "hasPendingInteraction"
  | "isUnread"
  | "isPinned"
> & {
  // Newer hosts expose these refinements; older hosts supply the indicator.
  status?: string;
  runtimeStatus?: string;
  queuedWork?: string;
};

export type ThreadState =
  | "waiting"
  | "working"
  | "error"
  | "idle"
  | "done"
  | "read";

/** One state per chat, in the order the sidebar should surface them. */
export function threadState(thread: StatusThread): ThreadState {
  const runtime = thread.runtimeStatus ?? thread.status;
  const pending =
    thread.hasPendingInteraction || thread.indicator === "waiting-for-input";
  const working =
    ["starting", "active", "stopping", "provisioning"].includes(
      runtime ?? "",
    ) ||
    [
      "runtime",
      "working-draft",
      "workflow",
      "background-agent",
      "background-command",
    ].includes(thread.indicator);
  const failed =
    runtime === "failed" ||
    thread.queuedWork === "failed" ||
    ["unread-error", "queued-failed"].includes(thread.indicator);
  const waiting =
    runtime === "waiting-for-host" ||
    thread.queuedWork === "waiting" ||
    ["draft", "queued-waiting", "plan-mode", "goal"].includes(thread.indicator);
  return pending
    ? "waiting"
    : working
      ? "working"
      : failed
        ? "error"
        : waiting
          ? "idle"
          : thread.isUnread
            ? "done"
            : "read";
}

export function ThreadStatus({ thread }: { thread: StatusThread }) {
  const state = threadState(thread);
  const icon =
    state === "waiting"
      ? "MessageQuestion"
      : state === "working"
        ? "Spinner"
        : state === "error"
          ? "AlertCircle"
          : state === "done"
            ? "CircleCheck"
            : thread.isPinned
              ? "Pin"
              : state === "idle"
                ? "Circle"
                : null;
  const [swap, setSwap] = useState<{
    icon: typeof icon;
    previous: typeof icon;
    revision: number;
    changing: boolean;
  }>({
    icon,
    previous: null,
    revision: 0,
    changing: false,
  });
  // Retain the outgoing glyph for its exit animation, not for status semantics.
  if (swap.icon !== icon) {
    setSwap({
      icon,
      previous: swap.icon,
      revision: swap.revision + 1,
      changing: true,
    });
  }
  useEffect(() => {
    if (!swap.changing) return;
    // Also clean up when reduced motion disables CSS animation events.
    const timeout = window.setTimeout(() => {
      setSwap((current) =>
        current.revision === swap.revision
          ? { ...current, previous: null, changing: false }
          : current,
      );
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [swap.revision, swap.changing]);

  return (
    <span
      className="pf-status"
      role={icon ? "img" : undefined}
      aria-hidden={icon ? undefined : true}
      aria-label={
        icon === "Pin"
          ? t("Закрепить")
          : icon
            ? (thread.indicatorLabel ??
              (state === "done" ? t("Готово") : undefined))
            : undefined
      }
      data-thread-status={state}
    >
      {swap.previous && (
        <span
          key={`out-${swap.revision}`}
          className="pf-status-glyph pf-status-exit"
          aria-hidden="true"
        >
          <Icon
            name={swap.previous}
            aria-hidden="true"
            className={
              swap.previous === "Spinner" ? "pf-status-spinner" : undefined
            }
          />
        </span>
      )}
      {icon && (
        <span
          key={`in-${swap.revision}`}
          className={`pf-status-glyph${swap.changing ? " pf-status-enter" : ""}`}
          style={swap.previous ? undefined : { animationDelay: "0ms" }}
          aria-hidden="true"
        >
          <Icon
            name={icon}
            aria-hidden="true"
            className={state === "working" ? "pf-status-spinner" : undefined}
          />
        </span>
      )}
    </span>
  );
}
