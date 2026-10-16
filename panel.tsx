import {
  MoveDialog,
  PendingMoves,
  PendingSectionMoves,
  SectionMoveDialog,
} from "./move-dialog";
import {
  SettingsNav,
  SettingsPane,
  isSettingsSection,
  type SettingsSection,
} from "./plugin-settings";
import {
  AppearanceDialog,
  Glyph,
  rowDecoration,
  useFolderLook,
} from "./appearance";
import { Help, RuleFields, type RuleDraft } from "./agents-apply";
import { usePrefs } from "./prefs-store";
import { folderKey, projectKey } from "./preferences";
import {
  SessionPolicyEditor,
  useSessionPolicyAvailable,
} from "./session-policy-ui";
import { ExecutionEditor } from "./execution-ui";
import { chipTakeover, takeableProjectControl } from "./composer-chip";
import {
  managedWorktreeEnvironment,
  placeOnHost,
  type PermissionMode,
  type ReasoningLevel,
  type ServiceTier,
} from "./execution";
import { t, useLanguage, LanguagePicker, direction } from "./i18n";
import { useCallback, useEffect, useState, useRef } from "react";
import {
  useRpc,
  useRealtime,
  useBbNavigate,
  experimental_NewThreadComposer as NewThreadComposer,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { createPortal } from "react-dom";
import type { Folder, ComposerRequest, rpcContract } from "./server";
import type { Archive } from "./archive";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./components/ui/dropdown-menu";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Icon } from "./components/ui/icon";
import {
  MoveToGroupDialog,
  FolderDialog,
  ProjectDialog,
  CopiesDialog,
} from "./tree-dialogs";
import {
  type Modal,
  isGroupFolder,
  sectionLevel,
  anchorOf,
  foreignHost,
  reparentTargets,
} from "./tree-model";
import { useTree } from "./use-tree";
export function ArchiveList({ bare = false }: { bare?: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const [items, setItems] = useState<Archive[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(() => {
    rpc.call("archive_list").then(
      (r) => setItems(r.archives),
      (e) => setError(String(e)),
    );
  }, [rpc]);
  useEffect(refresh, [refresh]);
  useRealtime("changed", refresh);
  const run = async (a: Archive) => {
    setBusy(a.id);
    setError("");
    try {
      if (a.state === "archiving")
        await rpc.call("archive", { folderId: a.folder.id });
      else await rpc.call("restore", { id: a.id });
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };
  const Wrapper = bare ? "div" : "section";
  return (
    <Wrapper className={bare ? "pf-archive-bare" : "pf-card"}>
      {!bare && <h2>{t("Архив разделов")}</h2>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!items.length && <p className="pf-archive-empty">{t("Архив пуст")}</p>}
      {items.map((a) => (
        <div key={a.id} className="pf-archive-item">
          <div className="pf-archive-info">
            <strong>{a.folder.name}</strong>
            <span className="pf-archive-meta">{a.folder.path}</span>
            <span className="pf-archive-meta">
              {new Date(a.createdAt).toLocaleString()} · {a.members.length}{" "}
              {t("разделов ·")}
              {a.threadIds.length} {t("чатов")}
            </span>
            {a.error && (
              <span role="alert" className="text-destructive pf-archive-meta">
                {a.error}
              </span>
            )}
          </div>
          <Button
            variant="outline"
            disabled={busy === a.id}
            onClick={() => void run(a)}
          >
            {busy === a.id
              ? t("Выполняю…")
              : a.state === "archived"
                ? t("Восстановить")
                : t("Повторить")}
          </Button>
        </div>
      ))}
    </Wrapper>
  );
}
export function Panel({ subPath }: PluginNavPanelProps) {
  const { rpc, data, error, refresh } = useTree();
  const sessionPolicyAvailable = useSessionPolicyAvailable();
  const [submitError, setSubmitError] = useState("");
  const composeRef = useRef<HTMLDivElement>(null);
  const [projectSlot, setProjectSlot] = useState<{
    node: HTMLElement;
    className: string;
  } | null>(null);
  /**
   * What a new chat in the chosen place starts with. These are seeds for BB's
   * own composer, not locks: its pickers still win, and a group nobody pinned
   * leaves BB's remembered choice exactly as it was. The composer re-seeds
   * every selection when a seed changes, so it is mounted only once the
   * values for the chosen folder have arrived.
   */
  const [chatSeeds, setChatSeeds] = useState<{
    key: string;
    seeds: {
      defaultProviderId?: string;
      defaultModel?: string;
      defaultReasoningLevel?: ReasoningLevel;
      defaultServiceTier?: ServiceTier;
      defaultPermissionMode?: PermissionMode;
      defaultEnvironment?:
        | ReturnType<typeof managedWorktreeEnvironment>
        | {
            type: "provider";
            environmentProviderId: "project-checkout";
            machine: { type: "existing"; hostId: string };
            inputs: { path: string };
          };
    };
  } | null>(null);
  useEffect(() => {
    const owner = composeRef.current;
    if (!owner) return;
    const takeover = chipTakeover(
      () => takeableProjectControl(owner),
      setProjectSlot,
    );
    takeover.sync();
    const observer = new MutationObserver(() => takeover.sync());
    observer.observe(owner, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      takeover.release();
    };
  }, [subPath, data.folders.length, data.roots.length]);
  useLanguage();
  const [modal, setModal] = useState<Modal | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [movingProject, setMovingProject] = useState<Folder | null>(null);
  const [movingSection, setMovingSection] = useState<Folder | null>(null);
  const [movingSectionHost, setMovingSectionHost] = useState<string | null>(
    null,
  );
  const [copyRoot, setCopyRoot] = useState<Folder | null>(null);
  const { look } = useFolderLook(data.folders);
  // Hide/show from the management page, the same flag the sidebar menu sets.
  const { items: itemStyles, saveItem: saveItemStyle } = usePrefs();
  const panelHiddenKey = (f: Folder, root: boolean) =>
    root ? projectKey(f.projectId) : folderKey(f.id);
  const panelHidden = (f: Folder, root: boolean) =>
    itemStyles[panelHiddenKey(f, root)]?.hidden === true;
  const togglePanelHidden = (f: Folder, root: boolean) => {
    const key = panelHiddenKey(f, root);
    void saveItemStyle(key, {
      ...(itemStyles[key] ?? {}),
      hidden: panelHidden(f, root) ? undefined : true,
    }).catch((e) => alert(String(e)));
  };
  const [styling, setStyling] = useState<{
    projectId: string;
    folder: Folder | null;
    name: string;
  } | null>(null);
  /** Device preselected in the working-copies dialog, when it opens from a free tab. */
  const [copyHost, setCopyHost] = useState<string | null>(null);
  /** Device tab in the project card; null = the selected root's own device. */
  const [cardHostState, setCardHostState] = useState<string | null>(null);
  /** AGENTS.md draft of the card's active device copy: draft, saved copy, its CLAUDE.md. */
  const [cardDraft, setCardDraft] = useState<string | null>(null);
  const [cardSaved, setCardSaved] = useState("");
  const [cardClaude, setCardClaude] = useState<string | null>(null);
  const [cardClaudeDraft, setCardClaudeDraft] = useState<string | null>(null);
  const [cardSaving, setCardSaving] = useState(false);
  const [cardRuleError, setCardRuleError] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailsPane, setDetailsPane] = useState<
    "rules" | "execution" | "session"
  >("rules");
  /** Settings section shown while no project or section is selected. */
  const [settingsView, setSettingsView] = useState<SettingsSection>("list");
  const [sideClosed, setSideClosed] = useState<Record<string, boolean>>({});
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [dragInfo, setDragInfo] = useState<{
    key: string;
    scope: string;
  } | null>(null);
  const [dropKey, setDropKey] = useState<{
    key: string;
    pos: "above" | "below" | "into";
  } | null>(null);
  const [regrouping, setRegrouping] = useState<Folder | null>(null);
  const reparent = async (folderId: string, parentId: string | null) => {
    setReorderError("");
    try {
      await rpc.call("section_reparent", { folderId, parentId });
      refresh();
    } catch (e) {
      setReorderError(String(e));
    }
  };
  const deleteGroup = async (g: Folder) => {
    if (data.folders.some((c) => c.parentId === g.id)) {
      setReorderError(
        t("Группа не пустая: сначала перенесите или заархивируйте её разделы."),
      );
      return;
    }
    if (!confirm(`${t("Удалить группу")} «${g.name}»?`)) return;
    try {
      await rpc.call("group_delete", { folderId: g.id });
      if (selectedKey === g.id) setSelectedKey(null);
      refresh();
    } catch (e) {
      setReorderError(String(e));
    }
  };
  const [reorderError, setReorderError] = useState("");
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleSaved, setRuleSaved] = useState(false);
  const [ruleError, setRuleError] = useState("");
  /** The mode saved for the folder; the open tab may differ until saved. */
  const [ruleModeSaved, setRuleModeSaved] = useState<
    "manual" | "inherit" | "custom" | null
  >(null);
  const nav = useBbNavigate();
  const [action, projectId, folderId] = (subPath || "")
    .replace(/^\//, "")
    .split("/")
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  const f =
    data.folders.find((f) => f.id === folderId && f.projectId === projectId) ??
    data.roots.find(
      (r) => r.projectId === projectId && folderId === `root:${r.hostId}`,
    );
  const rootSelected = folderId?.startsWith("root:") ?? false;
  const seedKey =
    action === "chat" && f
      ? `${f.projectId}:${rootSelected ? "" : f.id}:${f.hostId}`
      : "";
  useEffect(() => {
    if (!seedKey || !f) return;
    let live = true;
    const read = async () => {
      // A place that cannot be read still opens a chat: BB's own defaults.
      let seeds: NonNullable<typeof chatSeeds>["seeds"] = {};
      try {
        const r = await rpc.call("execution_read", {
          scope: rootSelected
            ? { kind: "project", projectId: f.projectId }
            : { kind: "folder", projectId: f.projectId, folderId: f.id },
        });
        const model = r.effective.model;
        const copies = rootSelected
          ? data.roots.filter((r) => r.projectId === f.projectId)
          : (f.paths ?? [{ hostId: f.hostId, path: f.path }]);
        const place = placeOnHost(
          r.effective.machine?.hostId,
          { hostId: f.hostId, path: f.path },
          copies,
        );
        seeds = {
          ...(model
            ? {
                defaultProviderId: model.providerId,
                defaultModel: model.model,
                ...(model.reasoningLevel
                  ? { defaultReasoningLevel: model.reasoningLevel }
                  : {}),
                ...(model.serviceTier
                  ? { defaultServiceTier: model.serviceTier }
                  : {}),
              }
            : {}),
          ...(r.effective.permissionMode
            ? { defaultPermissionMode: r.effective.permissionMode.value }
            : {}),
          defaultEnvironment:
            r.effective.environment?.value === "worktree"
              ? managedWorktreeEnvironment(place.hostId)
              : {
                  type: "provider",
                  environmentProviderId: "project-checkout",
                  machine: { type: "existing", hostId: place.hostId },
                  inputs: { path: place.path },
                },
        };
      } catch {}
      if (live) setChatSeeds({ key: seedKey, seeds });
    };
    void read();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey, rpc]);
  // `settings/<section>` opens a plugin settings section.
  useEffect(() => {
    if (action !== "settings" || !projectId || !isSettingsSection(projectId))
      return;
    setSelectedKey(null);
    setSettingsView(projectId);
  }, [action, projectId]);
  // `select/<project>/<folder-or-root:host>` opens management with the row selected.
  useEffect(() => {
    if (action !== "select" || !projectId) return;
    setSelectedKey(
      folderId?.startsWith("root:")
        ? `${projectId}|${folderId.slice("root:".length)}`
        : (folderId ?? null),
    );
  }, [action, projectId, folderId]);
  const machineName = (hostId: string) =>
    data.machines.find((m) => m.id === hostId)?.name ?? hostId;
  const projectCopies = (projectId: string) =>
    data.roots.filter((r) => r.projectId === projectId);
  /** One project entry in the tree; per-device copies live in the copies dialog. */
  const visibleRoots = data.roots.filter(
    (r, i) => data.roots.findIndex((x) => x.projectId === r.projectId) === i,
  );
  const sectionMenu = (r: Folder, depth = 0): React.ReactNode => {
    const otherHost =
      depth > 0 ? foreignHost(data.folders, data.roots, r) : null;
    const selected =
      depth === 0
        ? rootSelected && f?.projectId === r.projectId
        : f?.id === r.id;
    return (
      <div key={r.id}>
        {isGroupFolder(r) ? (
          <div
            className="pf-menu-group"
            style={{ paddingLeft: 8 + depth * 16 }}
          >
            <Icon name="Layers" />
            {r.name}
          </div>
        ) : (
          <DropdownMenuItem
            style={depth > 0 ? { paddingLeft: 8 + depth * 16 } : undefined}
            onSelect={() => {
              setSubmitError("");
              const dest =
                depth === 0
                  ? `root:${
                      rootSelected && f?.projectId === r.projectId
                        ? f.hostId
                        : r.hostId
                    }`
                  : r.id;
              nav.toPluginPanel("folders", {
                subPath: `chat/${r.projectId}/${dest}`,
              });
            }}
          >
            <Icon name="Folder" />
            {r.name}
            {otherHost && (
              <span className="pf-menu-host">· {machineName(otherHost)}</span>
            )}
            {selected ? " ✓" : ""}
          </DropdownMenuItem>
        )}
        {data.folders
          .filter(
            (c) =>
              c.projectId === r.projectId &&
              c.parentId === (depth === 0 ? null : r.id),
          )
          .map((c) => sectionMenu(c, depth + 1))}
      </div>
    );
  };
  const selectedNames: string[] = [];
  let ancestor = f;
  const visited = new Set<string>();
  while (ancestor && !visited.has(ancestor.id)) {
    visited.add(ancestor.id);
    selectedNames.unshift(ancestor.name);
    ancestor = ancestor.parentId
      ? data.folders.find((x) => x.id === ancestor!.parentId)
      : undefined;
  }
  const projectName = data.roots.find(
    (r) => r.projectId === projectId && r.hostId === f?.hostId,
  )?.name;
  if (!rootSelected && projectName) selectedNames.unshift(projectName);
  const levelOf = (f: Folder) => sectionLevel(data.folders, f);
  const scopeOf = (root: boolean, f: Folder) =>
    root ? "projects" : (f.parentId ?? `project:${f.projectId}`);
  const siblingKeys = (scope: string): string[] =>
    scope === "projects"
      ? [
          ...new Map(
            data.roots.map((r) => [r.projectId, `${r.projectId}|${r.hostId}`]),
          ).values(),
        ]
      : scope.startsWith("project:")
        ? data.folders
            .filter(
              (x) =>
                !x.parentId && x.projectId === scope.slice("project:".length),
            )
            .map((x) => x.id)
        : data.folders.filter((x) => x.parentId === scope).map((x) => x.id);
  const reorder = (scope: string, from: string, to: string, below = false) => {
    setReorderError("");
    const ids = siblingKeys(scope);
    const i = ids.indexOf(from);
    const j = ids.indexOf(to);
    if (i < 0 || j < 0 || (i === j && !below)) return;
    ids.splice(i, 1);
    ids.splice(ids.indexOf(to) + (below ? 1 : 0), 0, from);
    const call =
      scope === "projects"
        ? rpc.call("reorder", {
            kind: "projects",
            ids: ids.map((k) => k.split("|")[0]),
          })
        : rpc.call("reorder", {
            kind: "sections",
            projectId:
              data.folders.find((x) => x.id === ids[0])?.projectId ?? "",
            parentId: scope.startsWith("project:") ? null : scope,
            ids,
          });
    call.then(
      () => refresh(),
      (e) => setReorderError(String(e)),
    );
  };
  const sideNode = (f: Folder, root: boolean): React.ReactNode => {
    const key = root ? `${f.projectId}|${f.hostId}` : f.id;
    const children = data.folders.filter(
      (c) => c.projectId === f.projectId && c.parentId === (root ? null : f.id),
    );
    const open = !sideClosed[key];
    const level = root ? 0 : levelOf(f);
    const group = !root && isGroupFolder(f);
    const target = { projectId: f.projectId, folderId: root ? null : f.id };
    const scope = scopeOf(root, f);
    const dragged =
      dragInfo && !dragInfo.key.includes("|")
        ? data.folders.find((x) => x.id === dragInfo.key)
        : undefined;
    // Dropping a section on a group (or on its folder parent) regroups it without moving files.
    const canNest =
      !!dragged &&
      dragged.id !== f.id &&
      reparentTargets(data.folders, dragged, data.roots).some(
        (x) =>
          x.id === (root ? null : f.id) &&
          (root ? f.projectId === dragged.projectId : true),
      );
    const siblings = siblingKeys(scope);
    const at = siblings.indexOf(key);
    const move = (dir: -1 | 1) => {
      const other = siblings[at + dir];
      if (other) reorder(scope, key, other);
    };
    const dropHere = dropKey?.key === key ? dropKey.pos : null;
    const folderLook = look(f.projectId, root ? null : f);
    const row = rowDecoration(folderLook);
    return (
      <div key={key} className={root ? "pf-side-project" : undefined}>
        <div
          className={
            "pf-side-row" +
            row.className +
            (selectedKey === key ? " pf-selected" : "") +
            (dropHere ? ` pf-drop-${dropHere}` : "")
          }
          style={row.style}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("text/plain", key);
            event.dataTransfer.effectAllowed = "move";
            setDragInfo({ key, scope });
          }}
          onDragEnd={() => {
            setDragInfo(null);
            setDropKey(null);
          }}
          onDragOver={(event) => {
            if (!dragInfo || dragInfo.key === key) return;
            if (dragInfo.scope !== scope) {
              if (!canNest) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropKey({ key, pos: "into" });
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const rect = event.currentTarget.getBoundingClientRect();
            setDropKey({
              key,
              pos:
                event.clientY < rect.top + rect.height / 2 ? "above" : "below",
            });
          }}
          onDrop={(event) => {
            event.preventDefault();
            const info = dragInfo;
            const drop = dropKey;
            setDragInfo(null);
            setDropKey(null);
            if (!info || !drop || drop.key !== key) return;
            if (drop.pos === "into") {
              void reparent(info.key, root ? null : f.id);
              return;
            }
            reorder(scope, info.key, key, drop.pos === "below");
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuKey(key);
          }}
        >
          <button
            type="button"
            className="pf-icon"
            aria-label={f.name}
            aria-expanded={open}
            style={{ visibility: children.length ? "visible" : "hidden" }}
            onClick={() => setSideClosed((old) => ({ ...old, [key]: open }))}
          >
            <Icon name={open ? "ChevronDown" : "ChevronRight"} />
          </button>
          <button
            type="button"
            className="pf-side-label"
            title={f.path}
            onClick={() => setSelectedKey(key)}
          >
            <Glyph {...folderLook} />
            <span>{f.name}</span>
          </button>
          <DropdownMenu
            open={menuKey === key}
            onOpenChange={(o) => setMenuKey(o ? key : null)}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="pf-icon"
                aria-label={`${t("Действия чата")}: ${f.name}`}
              >
                <Icon name="MoreHorizontal" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!group && (
                <DropdownMenuItem
                  onSelect={() =>
                    nav.toPluginPanel("folders", {
                      subPath: `chat/${f.projectId}/${
                        root ? `root:${f.hostId}` : f.id
                      }`,
                    })
                  }
                >
                  <Icon name="MessageCirclePlus" />
                  {t("Новый чат")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() =>
                  setModal({ action: "create", target, folder: f, level })
                }
              >
                <Icon name="SectionAdd" />
                {t("Новый раздел")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  setModal({ action: "group", target, folder: f, level })
                }
              >
                <Icon name="Layers" />
                {t("Новая группа")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSelectedKey(key)}>
                <Icon name="SlidersHorizontal" />
                {t("Настройка")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  setStyling({
                    projectId: f.projectId,
                    folder: root ? null : f,
                    name: f.name,
                  })
                }
              >
                <Icon name="Palette" />
                {t("Оформление")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => togglePanelHidden(f, root)}>
                <Icon name={panelHidden(f, root) ? "Eye" : "EyeOff"} />
                {panelHidden(f, root)
                  ? t("Показать в дереве")
                  : t("Скрыть из дерева")}
              </DropdownMenuItem>
              {root && (
                <DropdownMenuItem onSelect={() => setNewProject(true)}>
                  <Icon name="FolderPlus" />
                  {t("Новый проект")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {(root || !group) && (
                <DropdownMenuItem
                  onSelect={() =>
                    setModal({
                      action: "rules",
                      target,
                      folder: f,
                      level,
                      copies: projectCopies(f.projectId),
                    })
                  }
                >
                  <Icon name="Settings" />
                  {t("Правила")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() =>
                  setModal({ action: "rename", target, folder: f, level })
                }
              >
                <Icon name="Edit" />
                {t("Переименовать")}
              </DropdownMenuItem>
              {!root &&
                reparentTargets(data.folders, f, data.roots).length > 0 && (
                  <DropdownMenuItem onSelect={() => setRegrouping(f)}>
                    <Icon name="MoveTo" />
                    {t("Переместить в группу…")}
                  </DropdownMenuItem>
                )}
              {!root && !group && (
                <DropdownMenuItem onSelect={() => setMovingSection(f)}>
                  <Icon name="FolderExport" />
                  {t("Изменить путь")}
                </DropdownMenuItem>
              )}
              {root && (
                <DropdownMenuItem onSelect={() => setMovingProject(f)}>
                  <Icon name="Folder" />
                  {t("Перенести")}
                </DropdownMenuItem>
              )}
              {root && (
                <DropdownMenuItem onSelect={() => setCopyRoot(f)}>
                  <Icon name="Copy" />
                  {t("Рабочие копии")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={at <= 0} onSelect={() => move(-1)}>
                {t("Сдвинуть вверх")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={at < 0 || at >= siblings.length - 1}
                onSelect={() => move(1)}
              >
                {t("Сдвинуть вниз")}
              </DropdownMenuItem>
              {group && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => void deleteGroup(f)}
                >
                  <Icon name="Trash2" />
                  {t("Удалить группу")}
                </DropdownMenuItem>
              )}
              {!root && !group && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    setModal({
                      action: "forget",
                      target: { projectId: f.projectId, folderId: f.id },
                      folder: f,
                      level,
                    })
                  }
                >
                  <Icon name="Trash2" />
                  {t("Удалить")}
                </DropdownMenuItem>
              )}
              {root && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() =>
                      setModal({
                        action: "remove",
                        target: {
                          projectId: f.projectId,
                          folderId: null,
                        },
                        folder: f,
                        level,
                      })
                    }
                  >
                    <Icon name="Trash2" />
                    {t("Удалить")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {open && children.length > 0 && (
          <div className="pf-side-children">
            {children.map((c) => sideNode(c, false))}
          </div>
        )}
      </div>
    );
  };
  const selectedNode = (() => {
    if (!selectedKey) return null;
    if (selectedKey.includes("|")) {
      const [projectId, hostId] = selectedKey.split("|");
      return (
        data.roots.find(
          (r) => r.projectId === projectId && r.hostId === hostId,
        ) ?? null
      );
    }
    return data.folders.find((x) => x.id === selectedKey) ?? null;
  })();
  const sel = selectedNode;
  const selRoot = !!sel && (selectedKey?.includes("|") ?? false);
  const selLevel = sel && !selRoot ? levelOf(sel) : 0;
  const selGroup = !selRoot && isGroupFolder(sel);
  const selRulesAllowed = !!sel && (selRoot || !selGroup);
  useEffect(() => {
    if (!selectedNode || !selRulesAllowed) {
      setRuleDraft(null);
      setRuleModeSaved(null);
      setDetailsPane("rules");
      return;
    }
    let live = true;
    rpc
      .call("rules_read", {
        projectId: selectedNode.projectId,
        folderId: selRoot ? null : selectedNode.id,
      })
      .then(
        (r) => {
          if (live) {
            setRuleDraft({
              mode: r.mode,
              sectionTemplate: r.template || r.suggestedSection,
              projectTemplate: r.projectTemplate || r.suggestedProject,
              custom: r.custom,
              customTarget: r.customTarget,
              startup: r.startup,
            });
            setRuleModeSaved(r.mode);
          }
        },
        () => {
          if (live) {
            setRuleDraft(null);
            setRuleModeSaved(null);
          }
        },
      );
    return () => {
      live = false;
    };
    // The row itself, not just the key: a card opened by deep link or from the
    // ⋯ menu has its key before the tree has loaded, and without the resolved
    // node here the first run bailed out and nothing ever asked again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedKey,
    selectedNode?.id,
    selectedNode?.projectId,
    selRoot,
    selGroup,
    selLevel,
    selRulesAllowed,
    rpc,
  ]);
  const cardCopies = sel && selRoot ? projectCopies(sel.projectId) : [];
  const sectionPaths =
    sel && !selRoot && !selGroup
      ? sel.paths?.length
        ? sel.paths
        : [{ hostId: sel.hostId, path: sel.path }]
      : [];
  /** Every machine BB knows: the ones holding a copy first, then the free ones. */
  const cardMachines = sel
    ? selRoot
      ? [
          ...cardCopies.map((c) => c.hostId),
          ...data.machines
            .filter((m) => !cardCopies.some((c) => c.hostId === m.id))
            .map((m) => m.id),
        ]
      : !selGroup
        ? [
            ...sectionPaths.map((p) => p.hostId),
            ...projectCopies(sel.projectId)
              .filter((c) => !sectionPaths.some((p) => p.hostId === c.hostId))
              .map((c) => c.hostId),
            ...data.machines
              .filter(
                (m) =>
                  !sectionPaths.some((p) => p.hostId === m.id) &&
                  !projectCopies(sel.projectId).some((c) => c.hostId === m.id),
              )
              .map((m) => m.id),
          ]
        : []
    : [];
  const cardHost =
    (sel && cardMachines.find((id) => id === (cardHostState ?? sel.hostId))) ||
    sel?.hostId ||
    "";
  /** The copy on the open device tab, or null when that machine has none yet. */
  const cardCopy = selRoot
    ? (cardCopies.find((c) => c.hostId === cardHost) ?? null)
    : null;
  const cardSectionPath =
    !selRoot && !selGroup
      ? (sectionPaths.find((p) => p.hostId === cardHost)?.path ?? null)
      : null;
  const online = (id: string) =>
    data.machines.find((m) => m.id === id)?.connected ?? false;
  useEffect(() => {
    // Follow the clicked row: stale device tabs leaked content across projects.
    setCardHostState(null);
  }, [selectedKey]);
  useEffect(() => {
    setCardDraft(null);
    setCardClaude(null);
    setCardClaudeDraft(null);
    setCardRuleError("");
    // Every project and section with rules shows its own AGENTS.md.
    if (!sel || !selRulesAllowed) return;
    // A machine without a copy or section path has no file to read yet.
    if (selRoot && !cardCopy) return;
    if (!selRoot && !selGroup && !cardSectionPath) return;
    let live = true;
    rpc
      .call("rules_read", {
        projectId: sel.projectId,
        folderId: selRoot ? null : sel.id,
        hostId: cardHost,
      })
      .then(
        (r) => {
          if (live) {
            setCardDraft(r.content);
            setCardSaved(r.content);
            setCardClaude(r.claude);
            setCardClaudeDraft(r.claude);
          }
        },
        (e) => {
          if (live) {
            setCardDraft("");
            setCardRuleError(String(e));
          }
        },
      );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sel?.projectId,
    sel?.id,
    selRoot,
    selRulesAllowed,
    cardHost,
    cardCopy,
    rpc,
  ]);
  const saveCardRules = async (file: "AGENTS.md" | "CLAUDE.md") => {
    if (!sel) return;
    const draft = file === "AGENTS.md" ? cardDraft : cardClaudeDraft;
    if (draft === null) return;
    setCardSaving(true);
    setCardRuleError("");
    try {
      const at = {
        projectId: sel.projectId,
        folderId: selRoot ? null : sel.id,
        hostId: cardHost,
      };
      await rpc.call("rules_save", {
        ...at,
        content: draft,
        sha: null,
        ...(file === "CLAUDE.md" ? { file } : {}),
      });
      if (file === "AGENTS.md") {
        setCardSaved(draft);
        const r = await rpc.call("rules_read", at);
        setCardClaude(r.claude);
        setCardClaudeDraft(r.claude);
      } else {
        setCardClaude(draft);
      }
    } catch (e) {
      setCardRuleError(String(e));
    } finally {
      setCardSaving(false);
    }
  };
  const saveRules = async () => {
    if (!selectedNode || !ruleDraft) return;
    setRuleSaving(true);
    setRuleSaved(false);
    setRuleError("");
    try {
      await rpc.call("rules_settings_save", {
        projectId: selectedNode.projectId,
        folderId: selRoot ? null : selectedNode.id,
        mode: ruleDraft.mode,
        sectionTemplate: ruleDraft.sectionTemplate,
        projectTemplate: ruleDraft.projectTemplate,
        custom: ruleDraft.custom,
        customTarget: ruleDraft.customTarget,
        startup: ruleDraft.startup,
      });
      setRuleModeSaved(ruleDraft.mode);
      setRuleSaved(true);
    } catch (e) {
      setRuleError(String(e));
    } finally {
      setRuleSaving(false);
    }
  };
  // AGENTS.md and CLAUDE.md of the selected copy: the files the agents read.
  const fileEditors = (
    <div className="pf-file-editors" key={cardHost}>
      <label className="pf-field">
        AGENTS.md · {machineName(cardHost)}
        {cardDraft === null ? (
          <p className="pf-agents-hint">{t("Загрузка…")}</p>
        ) : (
          <textarea
            className="pf-rules"
            rows={8}
            aria-label={`${t("Содержимое AGENTS.md")} — ${machineName(cardHost)}`}
            value={cardDraft}
            disabled={cardSaving}
            onChange={(e) => setCardDraft(e.target.value)}
          />
        )}
      </label>
      {cardClaude !== null && cardClaudeDraft !== null && (
        <label className="pf-field">
          CLAUDE.md · {machineName(cardHost)}
          <textarea
            className="pf-rules"
            rows={5}
            aria-label={`CLAUDE.md — ${machineName(cardHost)}`}
            value={cardClaudeDraft}
            disabled={cardSaving}
            onChange={(e) => setCardClaudeDraft(e.target.value)}
          />
          {cardClaudeDraft !== cardClaude && (
            <span className="pf-agents-actions">
              <Button
                size="sm"
                disabled={cardSaving || !cardClaudeDraft.trim()}
                onClick={() => void saveCardRules("CLAUDE.md")}
              >
                {cardSaving ? t("Сохраняю…") : t("Сохранить")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={cardSaving}
                onClick={() => setCardClaudeDraft(cardClaude)}
              >
                {t("Отмена")}
              </Button>
            </span>
          )}
        </label>
      )}
      {cardDraft !== null && cardDraft !== cardSaved && (
        <div className="pf-agents-actions">
          <Button
            size="sm"
            disabled={cardSaving || !cardDraft.trim()}
            onClick={() => void saveCardRules("AGENTS.md")}
          >
            <Icon name={cardSaving ? "Settings" : "CircleCheck"} />
            {cardSaving ? t("Сохраняю…") : t("Сохранить")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={cardSaving}
            onClick={() => setCardDraft(cardSaved)}
          >
            {t("Отмена")}
          </Button>
        </div>
      )}
      {cardRuleError && (
        <p role="alert" className="text-destructive text-sm">
          {cardRuleError}
        </p>
      )}
    </div>
  );
  const groupAnchor = selGroup ? anchorOf(data.folders, sel) : null;
  const groupDetails = sel && selGroup && (
    <section className="pf-card pf-details">
      <h2>{sel.name}</h2>
      <p className="pf-agents-hint">
        {t(
          "Группа объединяет разделы в дереве и не создаёт папку. Разделы внутри неё создаются в ближайшей папке выше.",
        )}{" "}
        {groupAnchor ? (
          <code>{groupAnchor.path}</code>
        ) : (
          t("Корень проекта на выбранном устройстве.")
        )}
      </p>
      <div className="pf-details-actions">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setModal({
              action: "create",
              target: { projectId: sel.projectId, folderId: sel.id },
              folder: sel,
              level: selLevel,
            })
          }
        >
          <Icon name="SectionAdd" />
          {t("Новый раздел")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setModal({
              action: "group",
              target: { projectId: sel.projectId, folderId: sel.id },
              folder: sel,
              level: selLevel,
            })
          }
        >
          <Icon name="Layers" />
          {t("Новая группа")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="pf-ghost-muted"
          onClick={() =>
            setModal({
              action: "rename",
              target: { projectId: sel.projectId, folderId: sel.id },
              folder: sel,
              level: selLevel,
            })
          }
        >
          <Icon name="Edit" />
          {t("Переименовать")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="pf-ghost-muted"
          onClick={() =>
            setStyling({
              projectId: sel.projectId,
              folder: sel,
              name: sel.name,
            })
          }
        >
          <Icon name="Palette" />
          {t("Оформление")}
        </Button>
        {reparentTargets(data.folders, sel, data.roots).length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="pf-ghost-muted"
            onClick={() => setRegrouping(sel)}
          >
            <Icon name="MoveTo" />
            {t("Переместить в группу…")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="pf-ghost-muted"
          onClick={() => void deleteGroup(sel)}
        >
          <Icon name="Trash2" />
          {t("Удалить группу")}
        </Button>
      </div>
    </section>
  );
  const details = selGroup
    ? groupDetails
    : sel && (
        <section className="pf-card pf-details">
          <h2>{sel.name}</h2>
          {selRoot ? (
            <div className="pf-root-copies">
              {cardMachines.length > 1 && (
                <div
                  className="pf-tabs"
                  role="tablist"
                  aria-label={t("Устройство")}
                >
                  {cardMachines.map((id) => {
                    const copy =
                      cardCopies.find((c) => c.hostId === id) ?? null;
                    // A solid bolt means the machine is connected right now.
                    return (
                      <button
                        key={`${sel.projectId}:${id}`}
                        type="button"
                        role="tab"
                        aria-selected={cardHost === id}
                        className={
                          "pf-tab" +
                          (cardHost === id ? " pf-selected" : "") +
                          (online(id) ? " pf-tab-live" : "") +
                          (copy ? "" : " pf-tab-free")
                        }
                        title={
                          copy?.path ??
                          (online(id)
                            ? t("Копии проекта на этой машине нет")
                            : t("Машина не подключена"))
                        }
                        onClick={() => setCardHostState(id)}
                      >
                        <Icon name="Zap" />
                        {machineName(id)}
                      </button>
                    );
                  })}
                </div>
              )}
              {cardCopy ? (
                <div className="pf-path-control">
                  <Input
                    readOnly
                    aria-label={t("Папка проекта")}
                    value={cardCopy.path}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={t("Выбрать папку")}
                    onClick={() => setMovingProject(cardCopy)}
                  >
                    <Icon name="Folder" />
                  </Button>
                </div>
              ) : (
                <div className="pf-path-control">
                  <Input
                    readOnly
                    disabled
                    value=""
                    aria-label={t("Папка проекта")}
                    placeholder={t("Копии проекта на этой машине нет")}
                  />
                  <Button
                    variant="outline"
                    disabled={!online(cardHost)}
                    onClick={() => {
                      setCopyHost(cardHost);
                      setCopyRoot(sel);
                    }}
                  >
                    <Icon name="Plus" />
                    {online(cardHost)
                      ? t("Добавить копию")
                      : t("Машина не подключена")}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="pf-root-copies">
              {cardMachines.length > 1 && (
                <div
                  className="pf-tabs"
                  role="tablist"
                  aria-label={t("Устройство")}
                >
                  {cardMachines.map((id) => {
                    const sectionPath =
                      sectionPaths.find((p) => p.hostId === id)?.path ?? null;
                    return (
                      <button
                        key={`${sel.id}:${id}`}
                        type="button"
                        role="tab"
                        aria-selected={cardHost === id}
                        className={
                          "pf-tab" +
                          (cardHost === id ? " pf-selected" : "") +
                          (online(id) ? " pf-tab-live" : "") +
                          (sectionPath ? "" : " pf-tab-free")
                        }
                        title={
                          sectionPath ??
                          (online(id)
                            ? t("Пути раздела на этой машине нет")
                            : t("Машина не подключена"))
                        }
                        onClick={() => setCardHostState(id)}
                      >
                        <Icon name="Zap" />
                        {machineName(id)}
                      </button>
                    );
                  })}
                </div>
              )}
              {cardSectionPath ? (
                <div className="pf-path-control">
                  <Input
                    readOnly
                    aria-label={t("Папка раздела")}
                    value={cardSectionPath}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={t("Выбрать папку")}
                    onClick={() => {
                      setMovingSectionHost(cardHost);
                      setMovingSection(sel);
                    }}
                  >
                    <Icon name="Folder" />
                  </Button>
                  {cardHost !== sel.hostId && sectionPaths.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        void rpc
                          .call("section_path_remove", {
                            folderId: sel.id,
                            hostId: cardHost,
                          })
                          .then(refresh, (e) => setCardRuleError(String(e)))
                      }
                    >
                      {t("Убрать путь")}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="pf-path-control">
                  <Input
                    readOnly
                    disabled
                    value=""
                    aria-label={t("Папка раздела")}
                    placeholder={t("Пути раздела на этой машине нет")}
                  />
                  <Button
                    variant="outline"
                    disabled={!online(cardHost)}
                    onClick={() => {
                      setMovingSectionHost(cardHost);
                      setMovingSection(sel);
                    }}
                  >
                    <Icon name="Plus" />
                    {online(cardHost)
                      ? t("Добавить путь")
                      : t("Машина не подключена")}
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="pf-details-actions">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                nav.toPluginPanel("folders", {
                  // Follow the open device tab: the copy you are looking at.
                  subPath: `chat/${sel.projectId}/${
                    selRoot ? `root:${cardCopy?.hostId ?? sel.hostId}` : sel.id
                  }`,
                })
              }
            >
              <Icon name="MessageCirclePlus" />
              {t("Новый чат")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setModal({
                  action: "create",
                  target: {
                    projectId: sel.projectId,
                    folderId: selRoot ? null : sel.id,
                  },
                  folder: selRoot ? (cardCopy ?? sel) : sel,
                  level: selLevel,
                })
              }
            >
              <Icon name="SectionAdd" />
              {t("Новый раздел")}
            </Button>
            {!selRoot && !selGroup && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setModal({
                    action: "rules",
                    target: {
                      projectId: sel.projectId,
                      folderId: sel.id,
                    },
                    folder: sel,
                    level: selLevel,
                  })
                }
              >
                <Icon name="Settings" />
                {t("Правила")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="pf-ghost-muted"
              onClick={() =>
                setModal({
                  action: "rename",
                  target: {
                    projectId: sel.projectId,
                    folderId: selRoot ? null : sel.id,
                  },
                  folder: sel,
                  level: selLevel,
                })
              }
            >
              <Icon name="Edit" />
              {t("Переименовать")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="pf-ghost-muted"
              onClick={() =>
                setStyling({
                  projectId: sel.projectId,
                  folder: selRoot ? null : sel,
                  name: sel.name,
                })
              }
            >
              <Icon name="Palette" />
              {t("Оформление")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="pf-ghost-muted"
              data-testid="pf-toggle-hidden"
              onClick={() => togglePanelHidden(sel, selRoot)}
            >
              <Icon name={panelHidden(sel, selRoot) ? "Eye" : "EyeOff"} />
              {panelHidden(sel, selRoot)
                ? t("Показать в дереве")
                : t("Скрыть из дерева")}
            </Button>
            {!selRoot &&
              reparentTargets(data.folders, sel, data.roots).length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="pf-ghost-muted"
                  onClick={() => setRegrouping(sel)}
                >
                  <Icon name="MoveTo" />
                  {t("Переместить в группу…")}
                </Button>
              )}
            {!selRoot && (
              <Button
                size="sm"
                variant="ghost"
                className="pf-ghost-muted"
                onClick={() => {
                  setMovingSectionHost(cardHost);
                  setMovingSection(sel);
                }}
              >
                <Icon name="FolderExport" />
                {t("Изменить путь")}
              </Button>
            )}
            {selRoot && (
              <Button
                size="sm"
                variant="ghost"
                className="pf-ghost-muted"
                onClick={() => setCopyRoot(sel)}
              >
                <Icon name="Copy" />
                {t("Рабочие копии")}
              </Button>
            )}
            {!selRoot && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setModal({
                    action: "forget",
                    target: { projectId: sel.projectId, folderId: sel.id },
                    folder: sel,
                    level: selLevel,
                  })
                }
              >
                <Icon name="Trash2" />
                {t("Удалить")}
              </Button>
            )}
            {selRoot && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setModal({
                    action: "remove",
                    target: { projectId: sel.projectId, folderId: null },
                    folder: sel,
                    level: selLevel,
                  })
                }
              >
                <Icon name="Trash2" />
                {t("Удалить")}
              </Button>
            )}
          </div>
          {selRulesAllowed && (
            <div
              className="pf-tabs pf-details-nav"
              role="tablist"
              aria-label={t("Настройки места")}
            >
              <button
                type="button"
                role="tab"
                aria-selected={detailsPane === "rules"}
                className={
                  "pf-tab" + (detailsPane === "rules" ? " pf-selected" : "")
                }
                onClick={() => setDetailsPane("rules")}
              >
                {t("Правила")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={detailsPane === "execution"}
                className={
                  "pf-tab" + (detailsPane === "execution" ? " pf-selected" : "")
                }
                onClick={() => setDetailsPane("execution")}
              >
                {t("Провайдер")}
              </button>
              {sessionPolicyAvailable && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailsPane === "session"}
                  className={
                    "pf-tab" + (detailsPane === "session" ? " pf-selected" : "")
                  }
                  onClick={() => setDetailsPane("session")}
                >
                  {t("Контекст сессии")}
                </button>
              )}
            </div>
          )}
          {selRulesAllowed && detailsPane === "rules" && (
            <div className="pf-agents-rule">
              <h3>
                {t("Правила AGENTS.md")}
                <Help
                  text={t(
                    "Вкладка решает, кто ведёт AGENTS.md этой папки: шаблон из настроек плагина, свой шаблон для этого места или ваш файл, в который плагин не пишет ничего.",
                  )}
                />
              </h3>
              {ruleDraft ? (
                <>
                  <RuleFields
                    draft={ruleDraft}
                    onChange={(patch) => {
                      setRuleDraft({ ...ruleDraft, ...patch });
                      setRuleSaved(false);
                    }}
                    showProject={selRoot}
                    namePrefix="pf-details"
                    fileSlot={
                      selRoot && !cardCopy ? (
                        <p className="pf-agents-empty">
                          {t("Копии проекта на этой машине нет")}
                        </p>
                      ) : (
                        fileEditors
                      )
                    }
                    customNote={
                      <p className="pf-agents-hint">
                        {selRoot
                          ? t(
                              "Общие для всех машин проекта: применяются к новым разделам и по кнопке «Применить к существующим разделам».",
                            )
                          : t(
                              "Этот шаблон получают новые подразделы и команда «Применить к существующим разделам» для этого раздела.",
                            )}
                      </p>
                    }
                  />
                  {/* The file tab saves through its own buttons; the mode itself
                  is only saved when it differs from the stored one. */}
                  {(ruleDraft.mode !== "manual" ||
                    ruleModeSaved !== "manual") && (
                    <div className="pf-agents-actions">
                      <Button
                        disabled={ruleSaving}
                        onClick={() => void saveRules()}
                      >
                        <Icon name={ruleSaved ? "CircleCheck" : "Settings"} />
                        {ruleSaved ? t("Сохранено") : t("Сохранить")}
                      </Button>
                    </div>
                  )}
                  {ruleError && (
                    <p role="alert" className="text-destructive text-sm">
                      {ruleError}
                    </p>
                  )}
                </>
              ) : (
                <p className="pf-agents-hint">{t("Загрузка…")}</p>
              )}
            </div>
          )}
          {sel && !selGroup && detailsPane === "execution" && (
            <div className="pf-agents-rule">
              <h3>
                {t("Провайдер, модель и агент")}
                <Help
                  text={t(
                    "Новый чат, созданный здесь, начинается с этих настроек. Выключенная группа наследуется: ближайший раздел выше, затем проект, затем настройки плагина, затем обычный выбор BB.",
                  )}
                />
              </h3>
              <ExecutionEditor
                scope={
                  selRoot
                    ? { kind: "project", projectId: sel.projectId }
                    : {
                        kind: "folder",
                        projectId: sel.projectId,
                        folderId: sel.id,
                      }
                }
              />
            </div>
          )}
          {sel &&
            !selGroup &&
            sessionPolicyAvailable &&
            detailsPane === "session" && (
              <div className="pf-agents-rule">
                <h3>
                  {t("Контекст сессии")}
                  <Help
                    text={t(
                      "Что загружается в сессию агента, начатую здесь: плагины BB, навыки, MCP-серверы и плагины CLI. Группа без своего значения наследуется: ближайший раздел выше, затем проект, затем настройки плагина.",
                    )}
                  />
                </h3>
                <SessionPolicyEditor
                  scope={
                    selRoot
                      ? { kind: "project", projectId: sel.projectId }
                      : {
                          kind: "folder",
                          projectId: sel.projectId,
                          folderId: sel.id,
                        }
                  }
                />
              </div>
            )}
        </section>
      );
  if (action === "chat")
    return f ? (
      <div className="pf-native-compose" ref={composeRef}>
        {projectSlot &&
          createPortal(
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={projectSlot.className}
                  data-promptbox-project-control=""
                  aria-label={t("Проекты и разделы")}
                  title={selectedNames.join(" / ")}
                >
                  <Icon name="Folder" />
                  <span className="min-w-0 truncate">
                    {selectedNames.join(" / ")}
                  </span>
                  <Icon name="ChevronDown" />
                </button>
              </DropdownMenuTrigger>
              {/* Anchored to the chip's left edge: centred on a chip that sits
                  at the composer's left edge, a wide tree hangs off-screen. */}
              <DropdownMenuContent
                align="start"
                collisionPadding={8}
                className="max-h-80 overflow-auto min-w-64 max-w-[min(90vw,26rem)]"
              >
                {visibleRoots.map((r) => sectionMenu(r))}
              </DropdownMenuContent>
            </DropdownMenu>,
            projectSlot.node,
          )}
        {submitError && (
          <p role="alert" className="text-destructive p-4">
            {submitError}
          </p>
        )}
        {chatSeeds?.key !== seedKey ? (
          <p className="p-4">{t("Загрузка…")}</p>
        ) : (
          <NewThreadComposer
            key={`${f.id}:${f.hostId}`}
            {...chatSeeds.seeds}
            defaultProjectId={projectId}
            defaultEnvironment={
              chatSeeds.seeds.defaultEnvironment ?? {
                type: "provider",
                environmentProviderId: "project-checkout",
                machine: { type: "existing", hostId: f.hostId },
                inputs: { path: f.path },
              }
            }
            draftKey={`project-folders:${f.id}`}
            layout="document"
            className="w-full"
            onSubmit={async (request) => {
              setSubmitError("");
              try {
                const t = await rpc.call("spawn", {
                  projectId,
                  folderId: rootSelected ? null : folderId,
                  hostId: f.hostId,
                  request: request as unknown as ComposerRequest,
                });
                nav.toThread(t.id);
              } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                const m = message.match(
                  /This section lives on the "(.+)" device\./,
                );
                setSubmitError(
                  m
                    ? `${t("Этот раздел живёт на устройстве")} «${m[1]}». ${t("Выберите это устройство или создайте раздел на нужном сервере.")}`
                    : message,
                );
                throw e;
              }
            }}
          />
        )}
      </div>
    ) : (
      <p className="p-4">{error || t("Загрузка…")}</p>
    );
  return (
    <div className="pf pf-panel" dir={direction()} data-bb-ru-skip="">
      <div className="pf-header">
        <h1>{t("Проекты и разделы")}</h1>
        <div className="pf-header-side">
          <LanguagePicker />
          <Button onClick={() => setNewProject(true)}>
            <Icon name="FolderPlus" />
            {t("Новый проект")}
          </Button>
        </div>
      </div>
      <p className="pf-intro">
        {t(
          "Разделы — папки проекта. Переписка и служебные материалы хранятся в скрытой папке",
        )}{" "}
        <code>.bb/chats/</code> {t("каждого раздела.")}
      </p>
      <div className="pf-layout">
        <aside className="pf-side" aria-label={t("Проекты и разделы")}>
          <nav aria-label={t("Настройки плагина")}>
            <div className="pf-side-heading">{t("Настройки")}</div>
            <SettingsNav
              variant="side"
              value={sel ? null : settingsView}
              onChange={(section) => {
                setSelectedKey(null);
                setSettingsView(section);
              }}
            />
          </nav>
          <div className="pf-side-heading">{t("Проекты")}</div>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {visibleRoots.map((r) => sideNode(r, true))}
          {reorderError && (
            <p role="alert" className="text-destructive pf-side-error">
              {reorderError}
            </p>
          )}
        </aside>
        <main className="pf-main">
          <PendingMoves />
          <PendingSectionMoves />
          {details}
          {!sel && (
            <SettingsPane
              section={settingsView}
              archive={<ArchiveList bare />}
            />
          )}
          {[error, ...data.errors].filter(Boolean).map((e, i) => (
            <p className="text-destructive" role="alert" key={i}>
              {e}
            </p>
          ))}
        </main>
      </div>
      <MoveDialog
        folder={movingProject}
        onClose={() => setMovingProject(null)}
        onMoved={refresh}
      />
      <SectionMoveDialog
        folder={movingSection}
        presetHost={movingSectionHost}
        onClose={() => {
          setMovingSection(null);
          setMovingSectionHost(null);
        }}
        onMoved={refresh}
      />
      <ProjectDialog
        defaultHostId={data.roots[0]?.hostId}
        open={newProject}
        onClose={() => setNewProject(false)}
        onCreated={refresh}
      />
      <FolderDialog
        modal={modal}
        onClose={() => setModal(null)}
        onCreated={refresh}
      />
      <AppearanceDialog
        target={styling}
        folders={data.folders}
        onClose={() => setStyling(null)}
      />
      <MoveToGroupDialog
        folder={regrouping}
        folders={data.folders}
        roots={data.roots}
        onClose={() => setRegrouping(null)}
        onMoved={refresh}
      />
      <CopiesDialog
        root={copyRoot}
        presetHost={copyHost}
        onRelocate={(copy) => {
          setCopyRoot(null);
          setMovingProject(copy);
        }}
        onClose={() => setCopyRoot(null)}
        onChanged={refresh}
      />
    </div>
  );
}
