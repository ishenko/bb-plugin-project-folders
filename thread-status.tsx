import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "./components/ui/icon";
import { t } from "./i18n";

type StatusThread = Pick<
  PluginSidebarThread,
  "indicator" | "indicatorLabel" | "hasPendingInteraction" | "isUnread"
> & {
  // Newer hosts expose these refinements; older hosts supply the indicator.
  status?: string;
  runtimeStatus?: string;
  queuedWork?: string;
};

export function ThreadStatus({ thread }: { thread: StatusThread }) {
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
  const state = pending
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
  const icon =
    state === "waiting"
      ? "MessageQuestion"
      : state === "working"
        ? "Spinner"
        : state === "error"
          ? "AlertCircle"
          : state === "idle"
            ? "Circle"
            : state === "done"
              ? "CircleCheck"
              : null;

  return (
    <span
      className="pf-status"
      role={icon ? "img" : undefined}
      aria-hidden={icon ? undefined : true}
      aria-label={
        icon
          ? (thread.indicatorLabel ??
            (state === "done" ? t("Готово") : undefined))
          : undefined
      }
      data-thread-status={state}
    >
      {icon && (
        <Icon
          name={icon}
          aria-hidden="true"
          className={state === "working" ? "pf-status-spinner" : undefined}
        />
      )}
    </span>
  );
}
