import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import {
  parseAssignments,
  parseTags,
  type Tag,
  type TagAssignments,
} from "./tags";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type State = { tags: Tag[]; assignments: TagAssignments; loaded: boolean };
/** One copy per page: every chat row and the settings page share it. */
let state: State = { tags: [], assignments: {}, loaded: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const set = (next: State) => {
  state = next;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** A change announced while a load is in flight; reload once it lands. */
let stale = false;
/**
 * Every chat row listens for changes, so concurrent calls share one request
 * instead of sending one per row.
 */
function load(rpc: Rpc): Promise<void> {
  if (loading) {
    stale = true;
    return loading;
  }
  loading = rpc
    .call("tags_get", null)
    .then(
      (r) => {
        const tags = parseTags(r.tags);
        set({
          tags,
          assignments: parseAssignments(r.assignments, tags),
          loaded: true,
        });
      },
      // A server that predates labels simply has none.
      () => set({ ...state, loaded: true }),
    )
    .finally(() => {
      loading = null;
      if (stale) {
        stale = false;
        void load(rpc);
      }
    });
  return loading;
}

/** Applies a change at once and puts the old state back if the server refuses. */
async function optimistic<T>(next: State, send: () => Promise<T>) {
  const previous = state;
  set(next);
  try {
    return await send();
  } catch (e) {
    set(previous);
    throw e;
  }
}

export function useTags() {
  const rpc = useRpc<typeof rpcContract>();
  const snap = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  useEffect(() => {
    if (!state.loaded && !loading) void load(rpc);
  }, [rpc]);
  useRealtime("tags", () => void load(rpc));
  const saveTag = useCallback(
    async (tag: { id?: string; name: string; color: string }) => {
      // RPC input must be plain JSON: a new label has no id at all, not `undefined`.
      const saved = await rpc.call(
        "tag_save",
        tag.id
          ? { id: tag.id, name: tag.name, color: tag.color }
          : { name: tag.name, color: tag.color },
      );
      const exists = state.tags.some((t) => t.id === saved.id);
      set({
        ...state,
        tags: exists
          ? state.tags.map((t) => (t.id === saved.id ? saved : t))
          : [...state.tags, saved],
      });
      return saved;
    },
    [rpc],
  );
  const deleteTag = useCallback(
    (id: string) =>
      optimistic(
        {
          ...state,
          tags: state.tags.filter((t) => t.id !== id),
          assignments: Object.fromEntries(
            Object.entries(state.assignments).filter(([, tag]) => tag !== id),
          ),
        },
        () => rpc.call("tag_delete", { id }),
      ),
    [rpc],
  );
  const reorderTags = useCallback(
    (ids: string[]) => {
      const byId = new Map(state.tags.map((t) => [t.id, t]));
      return optimistic(
        {
          ...state,
          tags: ids.flatMap((id) => byId.get(id) ?? []),
        },
        () => rpc.call("tag_reorder", { ids }),
      );
    },
    [rpc],
  );
  const setThreadTag = useCallback(
    (threadId: string, tagId: string | null) => {
      const assignments = { ...state.assignments };
      if (tagId) assignments[threadId] = tagId;
      else delete assignments[threadId];
      return optimistic({ ...state, assignments }, () =>
        rpc.call("thread_tag_set", { threadId, tagId }),
      );
    },
    [rpc],
  );
  const tagOf = useCallback(
    (threadId: string) => {
      const id = snap.assignments[threadId];
      return id ? snap.tags.find((t) => t.id === id) : undefined;
    },
    [snap],
  );
  return { ...snap, tagOf, saveTag, deleteTag, reorderTags, setThreadTag };
}
