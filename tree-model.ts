import type { Folder } from "./server";
export type Target = { projectId: string; folderId: string | null };
export type Modal = {
  action: "create" | "group" | "rules" | "rename" | "forget" | "remove";
  target: Target;
  folder: Folder;
  /** 0 = project root, 1 = section, 2 = subsection; 3+ has no rules. */
  level: number;
  /** Per-device copies of the project root, for the rules tabs. */
  copies?: Folder[];
  /** Preset the rules dialog to this device's tab. */
  rulesHost?: string;
};
export const isGroupFolder = (f: { kind?: string } | null | undefined) =>
  f?.kind === "group";
/** Section level for rules and looks: groups do not count, like on the server. */
export function sectionLevel(folders: readonly Folder[], f: Folder): number {
  let level = isGroupFolder(f) ? 0 : 1;
  const visited = new Set<string>();
  let cur = f.parentId ? folders.find((x) => x.id === f.parentId) : undefined;
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    if (!isGroupFolder(cur)) level++;
    cur = cur.parentId
      ? folders.find((x) => x.id === cur!.parentId)
      : undefined;
  }
  return level;
}
/** The nearest real folder of a tree node (groups skipped); null is the project root. */
export function anchorOf(
  folders: readonly Folder[],
  f: Folder | null | undefined,
) {
  const visited = new Set<string>();
  let cur = f ?? undefined;
  while (cur && isGroupFolder(cur) && !visited.has(cur.id)) {
    visited.add(cur.id);
    cur = cur.parentId
      ? folders.find((x) => x.id === cur!.parentId)
      : undefined;
  }
  return cur ?? null;
}
/**
 * A section whose folder is outside its tree parent: on another device or
 * elsewhere on the disk. It can sit anywhere in its project's tree.
 */
export function isDetached(
  folders: readonly Folder[],
  roots: readonly Folder[],
  f: Folder,
) {
  if (isGroupFolder(f)) return false;
  const parent = f.parentId ? folders.find((x) => x.id === f.parentId) : null;
  const base =
    anchorOf(folders, parent) ??
    roots.find((r) => r.projectId === f.projectId && r.hostId === f.hostId);
  return (
    !base ||
    base.hostId !== f.hostId ||
    !(
      f.path === base.path ||
      f.path.startsWith(base.path.replace(/\/$/, "") + "/")
    )
  );
}
/** The device of a section when it differs from its place in the tree, else null. */
export function foreignHost(
  folders: readonly Folder[],
  roots: readonly Folder[],
  f: Folder,
) {
  if (isGroupFolder(f)) return null;
  const parent = f.parentId ? folders.find((x) => x.id === f.parentId) : null;
  const host =
    anchorOf(folders, parent)?.hostId ??
    roots.find((r) => r.projectId === f.projectId)?.hostId;
  return host && host !== f.hostId ? f.hostId : null;
}
/** Where a section or group can go by changing only its place in the tree. */
export function reparentTargets(
  folders: readonly Folder[],
  f: Folder,
  roots: readonly Folder[],
) {
  const parent = f.parentId ? folders.find((x) => x.id === f.parentId) : null;
  const anchor = anchorOf(folders, parent);
  const free = isDetached(folders, roots, f);
  const inside = (node: Folder) => {
    const visited = new Set<string>();
    for (
      let cur: Folder | undefined = node;
      cur && !visited.has(cur.id);
      cur = cur.parentId
        ? folders.find((x) => x.id === cur!.parentId)
        : undefined
    ) {
      visited.add(cur.id);
      if (cur.id === f.id) return true;
    }
    return false;
  };
  const label = (node: Folder) => {
    const names: string[] = [];
    const visited = new Set<string>();
    for (
      let cur: Folder | undefined = node;
      cur && !visited.has(cur.id);
      cur = cur.parentId
        ? folders.find((x) => x.id === cur!.parentId)
        : undefined
    ) {
      visited.add(cur.id);
      names.unshift(cur.name);
    }
    return names.join(" / ");
  };
  const groups = folders.filter(
    (g) =>
      g.projectId === f.projectId &&
      !inside(g) &&
      (free ||
        (isGroupFolder(g) &&
          (anchor ? g.hostId === f.hostId : true) &&
          anchorOf(folders, g)?.id === anchor?.id)),
  );
  return [
    free
      ? { id: null, label: null }
      : { id: anchor?.id ?? null, label: anchor ? label(anchor) : null },
    ...groups.map((g) => ({ id: g.id as string | null, label: label(g) })),
  ].filter((x) => x.id !== (f.parentId ?? null));
}
