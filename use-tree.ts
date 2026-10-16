import { useCallback, useEffect, useState, useRef } from "react";
import { useRpc, useRealtime } from "@get-bb/plugin-sdk/app";
import type { Folder, rpcContract } from "./server";
import type { ProjectCategory } from "./project-categories";
export function useTree() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<{
    folders: Folder[];
    roots: Folder[];
    bindings: Record<string, string>;
    /** Chats filed by hand: thread id to section id, empty for the project root. */
    places: Record<string, string>;
    errors: string[];
    machines: { id: string; name: string; connected: boolean }[];
    categories: ProjectCategory[];
    projectCategories: Record<string, string>;
  }>({
    folders: [],
    roots: [],
    bindings: {},
    places: {},
    errors: [],
    machines: [],
    categories: [],
    projectCategories: {},
  });
  const [error, setError] = useState("");
  const shown = useRef("");
  const refresh = useCallback(() => {
    rpc.call("list").then(
      (d) => {
        // A server that predates hand-filed places simply has none.
        const next = {
          ...d,
          places: d.places ?? {},
          categories: d.categories ?? [],
          projectCategories: d.projectCategories ?? {},
        };
        // An unchanged answer must not redraw the whole tree.
        const key = JSON.stringify(next);
        if (key !== shown.current) {
          shown.current = key;
          setData(next);
        }
        setError("");
      },
      (e) => setError(String(e)),
    );
  }, [rpc]);
  // Bursts of `changed` (moves, git status, repo visibility) become one read.
  const timer = useRef<number | undefined>(undefined);
  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(refresh, 150);
  }, [refresh]);
  useEffect(() => {
    refresh();
    return () => window.clearTimeout(timer.current);
  }, [refresh]);
  useRealtime("changed", scheduleRefresh);
  // Back in the window: working trees may have changed in the meantime.
  useEffect(() => {
    let last = Date.now();
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last < 30_000) return;
      last = Date.now();
      scheduleRefresh();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [scheduleRefresh]);
  return { rpc, data, error, refresh };
}
