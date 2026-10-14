// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { ThreadStatus } from "./thread-status";

type StatusThread = ComponentProps<typeof ThreadStatus>["thread"];
const normal: StatusThread = {
  indicator: "none",
  indicatorLabel: null,
  hasPendingInteraction: false,
  isUnread: false,
  isPinned: false,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each<[string, Partial<StatusThread>, string, string]>([
  ["normal", {}, "Pin", "read"],
  ["idle", { indicator: "draft" }, "Pin", "idle"],
  ["waiting for host", { runtimeStatus: "waiting-for-host" }, "Pin", "idle"],
  ["working", { indicator: "runtime" }, "Spinner", "working"],
  ["starting", { runtimeStatus: "starting" }, "Spinner", "working"],
  ["completed", { isUnread: true }, "CircleCheck", "done"],
  [
    "error",
    { indicator: "unread-error", isUnread: true },
    "AlertCircle",
    "error",
  ],
  ["failed queue", { queuedWork: "failed" }, "AlertCircle", "error"],
  [
    "waiting for input",
    { indicator: "waiting-for-input" },
    "MessageQuestion",
    "waiting",
  ],
  [
    "pending interaction",
    { hasPendingInteraction: true, indicator: "runtime" },
    "MessageQuestion",
    "waiting",
  ],
])(
  "shows a single %s icon for a pinned thread",
  async (_, overrides, icon, state) => {
    const { container } = render(
      <ThreadStatus thread={{ ...normal, ...overrides, isPinned: true }} />,
    );
    await waitFor(() => {
      const icons = container.querySelectorAll("[data-icon]");
      expect(icons).toHaveLength(1);
      expect(icons[0]?.getAttribute("data-icon")).toBe(icon);
      expect(icons[0]?.hasAttribute("data-icon-pending")).toBe(false);
    });
    expect(
      container.firstElementChild?.getAttribute("data-thread-status"),
    ).toBe(state);
    expect(container.querySelector(".pf-status-spinner") !== null).toBe(
      icon === "Spinner",
    );
  },
);

it.each<[string, Partial<StatusThread>, string | null]>([
  ["normal", {}, null],
  ["idle", { indicator: "draft" }, "Circle"],
  ["working", { indicator: "runtime" }, "Spinner"],
  ["completed", { isUnread: true }, "CircleCheck"],
  ["error", { indicator: "unread-error" }, "AlertCircle"],
  ["waiting for input", { hasPendingInteraction: true }, "MessageQuestion"],
])("preserves the unpinned %s status", (_, overrides, icon) => {
  const { container } = render(
    <ThreadStatus thread={{ ...normal, ...overrides }} />,
  );
  const icons = container.querySelectorAll("[data-icon]");
  expect(icons).toHaveLength(icon ? 1 : 0);
  expect(icons[0]?.getAttribute("data-icon") ?? null).toBe(icon);
});

it("restores Pin after a completed pinned thread is read", async () => {
  const { container, rerender } = render(
    <ThreadStatus thread={{ ...normal, isPinned: true, isUnread: true }} />,
  );
  expect(container.querySelector('[data-icon="CircleCheck"]')).not.toBeNull();
  rerender(<ThreadStatus thread={{ ...normal, isPinned: true }} />);
  expect(container.querySelector('[data-icon="Pin"]')).not.toBeNull();
  await waitFor(() =>
    expect(container.querySelectorAll("[data-icon]")).toHaveLength(1),
  );
  expect(container.firstElementChild?.getAttribute("aria-label")).toBe("Pin");
});

it("shrinks the old icon and grows the new one without animating the initial render", () => {
  vi.useFakeTimers();
  const { container, rerender } = render(
    <ThreadStatus thread={{ ...normal, isPinned: true }} />,
  );
  expect(container.querySelector(".pf-status-enter")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  rerender(
    <ThreadStatus
      thread={{ ...normal, isPinned: true, indicator: "runtime" }}
    />,
  );
  expect(
    container.querySelector('.pf-status-exit [data-icon="Pin"]'),
  ).not.toBeNull();
  expect(
    container.querySelector('.pf-status-enter [data-icon="Spinner"]'),
  ).not.toBeNull();
  expect(
    container
      .querySelector('[data-icon="Spinner"]')
      ?.classList.contains("pf-status-spinner"),
  ).toBe(true);
  act(() => vi.advanceTimersByTime(200));
  expect(container.querySelector(".pf-status-exit")).toBeNull();
  expect(container.querySelector(".pf-status-enter")).toBeNull();
  expect(container.querySelectorAll("[data-icon]")).toHaveLength(1);
});

it("keeps only the latest swap when statuses change quickly", () => {
  vi.useFakeTimers();
  const { container, rerender } = render(
    <ThreadStatus thread={{ ...normal, isPinned: true }} />,
  );
  rerender(
    <ThreadStatus
      thread={{ ...normal, isPinned: true, indicator: "runtime" }}
    />,
  );
  act(() => vi.advanceTimersByTime(100));
  rerender(
    <ThreadStatus thread={{ ...normal, isPinned: true, isUnread: true }} />,
  );
  expect(container.querySelector('[data-icon="Pin"]')).toBeNull();
  expect(
    container.querySelector(".pf-status-exit .pf-status-spinner"),
  ).not.toBeNull();
  expect(
    container.querySelector('.pf-status-enter [data-icon="CircleCheck"]'),
  ).not.toBeNull();
  act(() => vi.advanceTimersByTime(100));
  expect(container.querySelector(".pf-status-enter")).not.toBeNull();
  act(() => vi.advanceTimersByTime(100));
  expect(container.querySelectorAll("[data-icon]")).toHaveLength(1);
  expect(container.querySelector('[data-icon="CircleCheck"]')).not.toBeNull();
});

it("does not animate when a status change keeps the same icon", () => {
  const { container, rerender } = render(
    <ThreadStatus thread={{ ...normal, isPinned: true }} />,
  );
  rerender(
    <ThreadStatus thread={{ ...normal, isPinned: true, indicator: "draft" }} />,
  );
  expect(
    container.querySelector(".pf-status-enter, .pf-status-exit"),
  ).toBeNull();
});

it("animates appearance and disappearance of an unpinned status", () => {
  vi.useFakeTimers();
  const { container, rerender } = render(<ThreadStatus thread={normal} />);
  rerender(<ThreadStatus thread={{ ...normal, indicator: "runtime" }} />);
  expect(
    container.querySelector<HTMLElement>(".pf-status-enter")?.style
      .animationDelay,
  ).toBe("0ms");
  act(() => vi.advanceTimersByTime(200));
  rerender(<ThreadStatus thread={normal} />);
  expect(
    container.querySelector('.pf-status-exit [data-icon="Spinner"]'),
  ).not.toBeNull();
  expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  act(() => vi.advanceTimersByTime(200));
  expect(container.querySelectorAll("[data-icon]")).toHaveLength(0);
});

it("cancels transition cleanup on unmount", () => {
  vi.useFakeTimers();
  const { rerender, unmount } = render(<ThreadStatus thread={normal} />);
  rerender(<ThreadStatus thread={{ ...normal, indicator: "runtime" }} />);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
