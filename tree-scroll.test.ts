// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { reserveTreeScrollGutter } from "./tree-scroll";

afterEach(() => document.body.replaceChildren());

function fixture() {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  const wrapper = document.createElement("div");
  wrapper.style.display = "contents";
  const tree = document.createElement("div");
  wrapper.append(tree);
  scroller.append(wrapper);
  document.body.append(scroller);
  return { scroller, wrapper, tree };
}

it("reserves space on the scroll owner instead of the tree or contents wrapper", () => {
  const { scroller, wrapper, tree } = fixture();
  const release = reserveTreeScrollGutter(tree);
  expect(scroller.style.getPropertyValue("scrollbar-gutter")).toBe("stable");
  expect(wrapper.style.getPropertyValue("scrollbar-gutter")).toBe("");
  expect(tree.style.getPropertyValue("scrollbar-gutter")).toBe("");
  release?.();
  expect(scroller.style.getPropertyValue("scrollbar-gutter")).toBe("");
});

it("restores the host's inline value and priority when unmounted", () => {
  const { scroller, tree } = fixture();
  scroller.style.setProperty("scrollbar-gutter", "auto", "important");
  const release = reserveTreeScrollGutter(tree);
  expect(scroller.style.getPropertyValue("scrollbar-gutter")).toBe("stable");
  release?.();
  expect(scroller.style.getPropertyValue("scrollbar-gutter")).toBe("auto");
  expect(scroller.style.getPropertyPriority("scrollbar-gutter")).toBe(
    "important",
  );
});

it("preserves a host that already reserves both edges", () => {
  const { scroller, tree } = fixture();
  scroller.style.setProperty("scrollbar-gutter", "stable both-edges");
  const release = reserveTreeScrollGutter(tree);
  expect(scroller.style.getPropertyValue("scrollbar-gutter")).toBe(
    "stable both-edges",
  );
  release?.();
  expect(scroller.style.getPropertyValue("scrollbar-gutter")).toBe(
    "stable both-edges",
  );
});

it("does not overwrite another owner's later change during cleanup", () => {
  const { scroller, tree } = fixture();
  const release = reserveTreeScrollGutter(tree);
  scroller.style.setProperty("scrollbar-gutter", "stable both-edges");
  release?.();
  expect(scroller.style.getPropertyValue("scrollbar-gutter")).toBe(
    "stable both-edges",
  );
});

it("does nothing without a scrolling ancestor", () => {
  const tree = document.createElement("div");
  document.body.append(tree);
  expect(reserveTreeScrollGutter(tree)).toBeUndefined();
  expect(document.body.style.getPropertyValue("scrollbar-gutter")).toBe("");
});
