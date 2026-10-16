export function reserveTreeScrollGutter(
  tree: HTMLElement,
): (() => void) | undefined {
  let scroller = tree.parentElement;
  while (scroller) {
    const computed = getComputedStyle(scroller);
    if (["auto", "scroll", "overlay"].includes(computed.overflowY)) {
      if (computed.scrollbarGutter.includes("stable")) return;
      // The SDK host owns scrolling; a gutter on the tree itself has no effect.
      const style = scroller.style;
      const previous = style.getPropertyValue("scrollbar-gutter");
      const priority = style.getPropertyPriority("scrollbar-gutter");
      style.setProperty("scrollbar-gutter", "stable");
      return () => {
        if (style.getPropertyValue("scrollbar-gutter") !== "stable") return;
        if (previous) style.setProperty("scrollbar-gutter", previous, priority);
        else style.removeProperty("scrollbar-gutter");
      };
    }
    scroller = scroller.parentElement;
  }
}
