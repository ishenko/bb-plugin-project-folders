import { MoveDialog, SectionMoveDialog } from "./move-dialog";
import { AppearanceDialog, useFolderLook } from "./appearance";
import { usePrefs } from "./prefs-store";
import { folderKey, projectKey } from "./preferences";
import {
  sortChats,
  visibleChats,
  isSectionCollapsed,
  parseCollapseState,
  placeOf,
  type CollapseRecord,
  hasFolderUnread,
  sortFoldersByActivity,
} from "./chat-list";
import { t, useLanguage, direction } from "./i18n";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
} from "react";
import { reserveTreeScrollGutter } from "./tree-scroll";
import {
  useBbNavigate,
  experimental_useSidebarThreads,
  experimental_useSidebarThreadActions,
  type PluginThreadListProps,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { Folder } from "./server";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./components/ui/dialog";
import { Button } from "./components/ui/button";
import { Icon } from "./components/ui/icon";
import { TreeToolbar } from "./tree-toolbar";
import { FolderHeading } from "./folder-heading";
import { MemoThreadRow } from "./thread-row";
import { MoveToGroupDialog, FolderDialog, ProjectDialog } from "./tree-dialogs";
import {
  type Modal,
  isGroupFolder,
  sectionLevel,
  foreignHost,
  reparentTargets,
} from "./tree-model";
import { useTree } from "./use-tree";
import {
  ProjectCategoryTree,
  ProjectCategoryDialog,
  type CategoryDialogState,
} from "./project-categories-ui";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./components/ui/dropdown-menu";
export function Tree(props: PluginThreadListProps) {
  const treeRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (treeRef.current) return reserveTreeScrollGutter(treeRef.current);
  }, []);
  const language = useLanguage();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { rpc, data, error, refresh } = useTree();
  const { prefs, look } = useFolderLook(data.folders);
  const listSettings = prefs.chatList;
  // Hidden projects and sections stay out of the tree unless «Show hidden» is on; their chats keep working.
  const { items, saveItem } = usePrefs();
  const showHidden = prefs.view.showHidden;
  const hiddenKey = (f: Folder, root: boolean) =>
    root ? projectKey(f.projectId) : folderKey(f.id);
  const isHidden = (f: Folder, root: boolean) =>
    items[hiddenKey(f, root)]?.hidden === true;
  const toggleHidden = (f: Folder, root: boolean) => {
    const key = hiddenKey(f, root);
    void saveItem(key, {
      ...(items[key] ?? {}),
      hidden: isHidden(f, root) ? undefined : true,
    }).catch((e) => alert(String(e)));
  };
  const [styling, setStyling] = useState<{
    projectId: string;
    folder: Folder | null;
    name: string;
  } | null>(null);
  const [regrouping, setRegrouping] = useState<Folder | null>(null);
  const { threads, projects, status } = experimental_useSidebarThreads();
  const environmentKey = threads.map((t) => t.environment?.id ?? "").join("|");
  useEffect(refresh, [environmentKey, refresh]);
  const actions = experimental_useSidebarThreadActions();
  const nav = useBbNavigate();
  const [modal, setModal] = useState<Modal | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [categoryDialog, setCategoryDialog] =
    useState<CategoryDialogState | null>(null);
  const [unrootedMenu, setUnrootedMenu] = useState<string | null>(null);
  const [movingProject, setMovingProject] = useState<Folder | null>(null);
  const [movingSection, setMovingSection] = useState<Folder | null>(null);
  const [movingChat, setMovingChat] = useState<PluginSidebarThread | null>(
    null,
  );
  const [draggedChat, setDraggedChat] = useState<PluginSidebarThread | null>(
    null,
  );
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** Why the row under the pointer refuses the drag; null while it accepts. */
  const [dropReason, setDropReason] = useState<string | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState("");
  /** The chat was asked to switch its own working folder; it answers in a turn. */
  const [moveNotice, setMoveNotice] = useState("");
  const [selectedMove, setSelectedMove] = useState<{
    folder: Folder;
    root: boolean;
  } | null>(null);
  const [moveCollapsed, setMoveCollapsed] = useState<Record<string, boolean>>(
    {},
  );
  useEffect(() => {
    setSelectedMove(null);
    setMoveCollapsed({});
  }, [movingChat?.id]);
  /** Where a chat sits in the tree: its filed place, else its working folder. */
  const place = (chat: PluginSidebarThread) =>
    placeOf(chat, data.bindings, data.places);
  /**
   * Where a chat goes when filed into a tree node, or null when the node
   * cannot hold chats. Only the place in the tree changes: BB keeps a chat on
   * the environment it was created with, so its working folder stays put.
   */
  const moveTarget = (
    chat: PluginSidebarThread | null,
    folder: Folder,
    root: boolean,
  ) => {
    if (!chat || chat.projectId !== folder.projectId) return null;
    if (!root && isGroupFolder(folder)) return null;
    return {
      threadId: chat.id,
      projectId: folder.projectId,
      folderId: root ? null : folder.id,
    };
  };
  const canMove = (
    chat: PluginSidebarThread | null,
    folder: Folder,
    root = false,
  ) => !!moveTarget(chat, folder, root);
  const deviceName = (hostId: string) =>
    data.machines.find((m) => m.id === hostId)?.name ?? hostId;
  /**
   * Why a node refuses the chat, or null when it takes it. A refusal is said
   * out loud: a row that only greys out reads as a broken drag.
   */
  const moveBlock = (
    chat: PluginSidebarThread | null,
    folder: Folder,
    root: boolean,
  ): string | null => {
    if (!chat || moveTarget(chat, folder, root)) return null;
    if (chat.projectId !== folder.projectId)
      return t("Чат остаётся в своём проекте.");
    return t("У группы нет своей папки: выберите раздел внутри неё.");
  };
  /**
   * The machine a chat runs on, when it sits in a section of another one.
   *
   * Filing a chat inside its own device is just an arrangement of the tree and
   * needs no mark. A section bound to another machine is a real mismatch —
   * the folder is on the server, the chat is on the laptop — so the badge
   * names the machine the chat runs on and its tooltip the folder it works in.
   */
  const worksIn = (chat: PluginSidebarThread) => {
    const placedId = data.places[chat.id];
    if (placedId === undefined) return undefined;
    const natural = data.bindings[chat.environment?.id ?? ""] ?? null;
    if (natural === (placedId || null)) return undefined;
    const placed = placedId
      ? data.folders.find((f) => f.id === placedId)
      : null;
    if (!placed || placed.hostId === chat.host?.id) return undefined;
    const folder = natural
      ? data.folders.find((f) => f.id === natural)
      : data.roots.find(
          (r) => r.projectId === chat.projectId && r.hostId === chat.host?.id,
        );
    if (!folder) return undefined;
    return {
      label: deviceName(chat.host?.id ?? folder.hostId),
      path: `${t("Работает в")} ${folder.path}`,
    };
  };
  const moveChat = async (
    chat: PluginSidebarThread,
    folder: Folder,
    root: boolean,
    fromDrop = false,
  ) => {
    const target = moveTarget(chat, folder, root);
    if (moveBusy || !target) return;
    setMoveBusy(true);
    setMoveError("");
    setMoveNotice("");
    setDraggedChat(null);
    setDropTarget(null);
    setDropReason(null);
    try {
      // Same machine: the chat's working folder follows it. BB has no plugin
      // API for that (get-bb/bb#3904), so the server asks the chat itself —
      // it owns `update_environment_directory`. Another device can only take
      // the place in the tree, because a chat cannot change machine.
      const sameDevice = chat.host?.id === folder.hostId;
      if (sameDevice) {
        const moved = await rpc.call("thread_move", {
          ...target,
          hostId: folder.hostId,
        });
        setMoveNotice(
          moved.asked
            ? `${t("Чат сам переключает рабочую папку:")} ${moved.path}`
            : "",
        );
      } else await rpc.call("thread_place", target);
      setMovingChat(null);
      setCollapseRecords((old) => {
        const next = {
          ...old,
          [folder.id]: { collapsed: false, at: Date.now() },
        };
        localStorage.setItem("project-folders:collapsed", JSON.stringify(next));
        return next;
      });
      refresh();
    } catch (error) {
      setMoveError(String(error));
      if (!fromDrop) setMovingChat(chat);
    } finally {
      setMoveBusy(false);
    }
  };
  // Stable row callbacks, so memoized rows skip unrelated re-renders.
  const navigateRef = useRef(props.onNavigate);
  navigateRef.current = props.onNavigate;
  const onNavigate = useCallback(() => navigateRef.current(), []);
  const startMove = useCallback((chat: PluginSidebarThread) => {
    setMoveError("");
    setMovingChat(chat);
  }, []);
  const dragChat = useCallback((chat: PluginSidebarThread | null) => {
    setDraggedChat(chat);
    if (!chat) {
      setDropTarget(null);
      setDropReason(null);
    }
  }, []);
  const unplace = useCallback(
    async (chat: PluginSidebarThread) => {
      setMoveError("");
      try {
        await rpc.call("thread_place_clear", { threadId: chat.id });
        refresh();
      } catch (error) {
        setMoveError(String(error));
      }
    },
    [rpc, refresh],
  );

  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const [collapseRecords, setCollapseRecords] = useState<
    Record<string, CollapseRecord>
  >(() => {
    try {
      return parseCollapseState(
        localStorage.getItem("project-folders:collapsed"),
      );
    } catch {
      return {};
    }
  });

  const isClosed = (f: Folder, root: boolean) =>
    isSectionCollapsed({
      folderId: f.id,
      projectId: f.projectId,
      root,
      folders: data.folders,
      bindings: data.bindings,
      places: data.places,
      threads,
      record: collapseRecords[f.id],
      activeThreadId: props.activeThreadId,
      autoCollapseInactive: listSettings.autoCollapseInactive,
      thresholdMs: listSettings.inactiveHours * 60 * 60 * 1000,
    });

  const isProjectClosed = (pId: string) => {
    const record = collapseRecords[pId];
    return !!record?.collapsed;
  };

  const toggle = (id: string, currentlyClosed: boolean) =>
    setCollapseRecords((old) => {
      const next = {
        ...old,
        [id]: { collapsed: !currentlyClosed, at: Date.now() },
      };
      localStorage.setItem("project-folders:collapsed", JSON.stringify(next));
      return next;
    });
  const open = (f: Folder, root: boolean) => {
    nav.toPluginPanel("folders", {
      subPath: `chat/${f.projectId}/${root ? `root:${f.hostId}` : f.id}`,
    });
    props.onNavigate();
  };
  /** One entry per project; per-device copies are opened from the card or composer machine control. */
  const visibleRoots = sortFoldersByActivity(
    data.roots.filter(
      (r, i) =>
        data.roots.findIndex((x) => x.projectId === r.projectId) === i &&
        (showHidden || !isHidden(r, true)),
    ),
    {
      enabled: listSettings.sortSectionsByActivity,
      root: true,
      folders: data.folders,
      bindings: data.bindings,
      places: data.places,
      threads,
    },
  );
  const rows = (
    ts: readonly PluginSidebarThread[],
    group: string,
    sort = listSettings.sort,
    limit = listSettings.limit,
  ) => {
    const sorted = sortChats(ts, sort, language);
    const listOpts = {
      limit,
      hideIdleMs: listSettings.hideIdleHours * 60 * 60 * 1000,
      activeThreadId: props.activeThreadId,
    };
    const shown = visibleChats(sorted, {
      ...listOpts,
      expanded: !!expanded[group],
    });
    const hasHidden =
      visibleChats(sorted, { ...listOpts, expanded: false }).length <
      sorted.length;
    return (
      <>
        {shown.map((thread) => (
          <MemoThreadRow
            key={thread.id}
            thread={thread}
            active={props.activeThreadId === thread.id}
            onNavigate={onNavigate}
            onMove={startMove}
            worksIn={worksIn(thread)}
            onUnplace={
              data.places[thread.id] === undefined ? undefined : unplace
            }
            onDrag={dragChat}
          />
        ))}
        {hasHidden && (
          <button
            className="pf-show-more"
            aria-expanded={!!expanded[group]}
            onClick={() =>
              setExpanded((old) => ({ ...old, [group]: !old[group] }))
            }
          >
            <Icon name={expanded[group] ? "ChevronUp" : "ChevronDown"} />
            {expanded[group]
              ? t("Свернуть список")
              : `${t("Показать все")} (${sorted.length})`}
          </button>
        )}
      </>
    );
  };
  const deleteGroup = async (g: Folder) => {
    if (data.folders.some((c) => c.parentId === g.id)) {
      alert(
        t("Группа не пустая: сначала перенесите или заархивируйте её разделы."),
      );
      return;
    }
    if (!confirm(`${t("Удалить группу")} «${g.name}»?`)) return;
    try {
      await rpc.call("group_delete", { folderId: g.id });
      refresh();
    } catch (e) {
      alert(String(e));
    }
  };
  const node = (f: Folder, root = false): React.ReactNode => {
    const level = root ? 0 : sectionLevel(data.folders, f);
    const group = !root && isGroupFolder(f);
    const children = sortFoldersByActivity(
      data.folders.filter(
        (c) =>
          c.projectId === f.projectId &&
          c.parentId === (root ? null : f.id) &&
          (showHidden || !isHidden(c, false)),
      ),
      {
        enabled: listSettings.sortSectionsByActivity,
        root: false,
        folders: data.folders,
        bindings: data.bindings,
        places: data.places,
        threads,
      },
    );
    const target = { projectId: f.projectId, folderId: root ? null : f.id };
    const ts = threads.filter(
      (t) =>
        t.projectId === f.projectId && (root ? !place(t) : place(t) === f.id),
    );
    const folderClosed = isClosed(f, root);
    const folderUnread = hasFolderUnread({
      folderId: f.id,
      projectId: f.projectId,
      root,
      folders: data.folders,
      bindings: data.bindings,
      places: data.places,
      threads,
    });
    const folderLook = look(f.projectId, root ? null : f);
    return (
      <div
        key={f.id}
        className={
          (root ? "pf-project" : "pf-folder") +
          (isHidden(f, root) ? " pf-hidden" : "")
        }
      >
        <FolderHeading
          folder={f}
          root={root}
          hidden={isHidden(f, root)}
          onToggleHidden={() => toggleHidden(f, root)}
          closed={folderClosed}
          empty={!children.length && !ts.length}
          unread={folderUnread && listSettings.boldUnread}
          highlighted={dropTarget === f.id}
          refused={dropTarget === f.id && !!dropReason}
          rulesAllowed={root || !group}
          look={folderLook}
          group={group}
          device={(() => {
            const host = root ? null : foreignHost(data.folders, data.roots, f);
            return host
              ? (data.machines.find((m) => m.id === host)?.name ?? host)
              : undefined;
          })()}
          onNewGroup={() =>
            setModal({ action: "group", target, folder: f, level })
          }
          onMoveToGroup={
            !root && reparentTargets(data.folders, f, data.roots).length
              ? () => setRegrouping(f)
              : undefined
          }
          onDeleteGroup={() => void deleteGroup(f)}
          onAppearance={() =>
            setStyling({
              projectId: f.projectId,
              folder: root ? null : f,
              name: f.name,
            })
          }
          onToggle={() => toggle(f.id, folderClosed)}
          onNewChat={() => void open(f, root)}
          onDragOver={(event) => {
            // A refusing row still takes the drop: the reason is worth more
            // than a dead cursor over the row the user aimed at.
            if (
              moveBusy ||
              !draggedChat ||
              draggedChat.projectId !== f.projectId
            )
              return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropTarget(f.id);
            setDropReason(moveBlock(draggedChat, f, root));
          }}
          onDragLeave={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            ) {
              setDropTarget(null);
              setDropReason(null);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (
              !draggedChat ||
              event.dataTransfer.getData(
                "application/x-bb-project-folders-thread",
              ) !== draggedChat.id
            )
              return;
            const blocked = moveBlock(draggedChat, f, root);
            if (blocked) {
              setDraggedChat(null);
              setDropTarget(null);
              setDropReason(null);
              setMoveError(blocked);
              return;
            }
            void moveChat(draggedChat, f, root, true);
          }}
          onNewProject={() => setNewProject(true)}
          onCategory={() =>
            setCategoryDialog({
              kind: "assign",
              project: { id: f.projectId, name: f.name },
            })
          }
          onCreate={() =>
            setModal({ action: "create", target, folder: f, level })
          }
          onConfigure={() => {
            nav.toPluginPanel("folders", {
              subPath: `select/${f.projectId}/${
                root ? `root:${f.hostId}` : f.id
              }`,
            });
            props.onNavigate();
          }}
          onMove={() => setMovingProject(f)}
          onRules={() =>
            setModal({
              action: "rules",
              target,
              folder: f,
              level,
              copies: root
                ? data.roots.filter((r) => r.projectId === f.projectId)
                : undefined,
            })
          }
          onRename={() =>
            setModal({ action: "rename", target, folder: f, level })
          }
          onRelocate={() => setMovingSection(f)}
          onRemove={() =>
            setModal({ action: "remove", target, folder: f, level })
          }
          onArchive={() =>
            setModal({ action: "forget", target, folder: f, level })
          }
        />
        {!folderClosed && (
          <div className="pf-children">
            {children.map((c) => node(c, false))}
            {rows(ts, f.id, folderLook.sort, folderLook.limit)}
          </div>
        )}
      </div>
    );
  };
  const unrootedProject = (p: (typeof projects)[number]) => {
    const projectClosed = isProjectClosed(p.id);
    const projectThreads = threads.filter((t) => t.projectId === p.id);
    const projectUnread = projectThreads.some(
      (t) => !t.isArchived && !!t.isUnread,
    );
    return (
      <div
        className={"pf-project" + (p.isPersonal ? " pf-category" : "")}
        key={p.id}
      >
        <div
          className={
            "pf-heading" + (p.isPersonal ? " pf-category-heading" : "")
          }
          onContextMenu={(event) => {
            if (p.isPersonal) return;
            event.preventDefault();
            setUnrootedMenu(p.id);
          }}
        >
          <button
            type="button"
            className={
              p.isPersonal
                ? "pf-category-toggle"
                : "pf-label" + (projectUnread ? " pf-unread" : "")
            }
            aria-expanded={p.isPersonal ? !projectClosed : undefined}
            onClick={() => toggle(p.id, projectClosed)}
          >
            {p.isPersonal ? (
              <>
                <span className="pf-category-name">{t("Без проекта")}</span>
                <Icon name={projectClosed ? "ChevronRight" : "ChevronDown"} />
              </>
            ) : (
              <>
                {projectThreads.length ? (
                  <Icon name={projectClosed ? "ChevronRight" : "ChevronDown"} />
                ) : (
                  <span className="pf-chevron-spacer" aria-hidden />
                )}
                <span>{p.name}</span>
              </>
            )}
          </button>
          <button
            className="pf-icon"
            aria-label={t("Новый чат без проекта")}
            onClick={() => {
              actions.openNewThread({ projectId: p.id, focusPrompt: true });
              props.onNavigate();
            }}
          >
            <Icon name="MessageCirclePlus" />
          </button>
          {!p.isPersonal && (
            <DropdownMenu
              open={unrootedMenu === p.id}
              onOpenChange={(open) => setUnrootedMenu(open ? p.id : null)}
            >
              <DropdownMenuTrigger asChild>
                <button
                  className="pf-icon"
                  aria-label={`${t("Действия")}: ${p.name}`}
                >
                  <Icon name="MoreHorizontal" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() =>
                    setCategoryDialog({ kind: "assign", project: p })
                  }
                >
                  <Icon name="Layers" />
                  {t("Категория")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {!projectClosed && (
          <div className="pf-children">{rows(projectThreads, p.id)}</div>
        )}
      </div>
    );
  };
  const projectEntries = [
    ...visibleRoots.map((f) => ({ id: f.projectId, node: node(f, true) })),
    ...projects
      .filter(
        (p) =>
          !p.isPersonal &&
          !data.roots.some((r) => r.projectId === p.id) &&
          (showHidden || !items[projectKey(p.id)]?.hidden),
      )
      .map((p) => ({ id: p.id, node: unrootedProject(p) })),
  ];
  return (
    <div
      ref={treeRef}
      className={
        "pf pf-tree" + (prefs.view.density === "compact" ? " pf-compact" : "")
      }
      style={{ "--pf-indent": `${prefs.view.indent}px` } as React.CSSProperties}
      data-bb-ru-skip=""
      dir={direction()}
    >
      <TreeToolbar onNavigate={props.onNavigate} />
      <Button
        variant="ghost"
        className="mb-2 w-full justify-start"
        onClick={() => setNewProject(true)}
      >
        <Icon name="FolderPlus" />
        {t("Новый проект")}
      </Button>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {status === "loading" && <p>{t("Загрузка…")}</p>}
      <ProjectCategoryTree
        categories={data.categories}
        assignments={data.projectCategories}
        projects={projectEntries}
        activeProjectId={
          threads.find((thread) => thread.id === props.activeThreadId)
            ?.projectId
        }
        isClosed={(id) => !!collapseRecords[`category:${id}`]?.collapsed}
        onToggle={(id) =>
          toggle(
            `category:${id}`,
            !!collapseRecords[`category:${id}`]?.collapsed,
          )
        }
        onEdit={setCategoryDialog}
      />
      {projects
        .filter(
          (p) => p.isPersonal && !data.roots.some((r) => r.projectId === p.id),
        )
        .map(unrootedProject)}
      <button
        type="button"
        className="pf-icon pf-manage"
        aria-label={t("Управление разделами")}
        title={t("Управление разделами")}
        onClick={() => nav.toPluginPanel("folders")}
      >
        <Icon name="Settings" />
      </button>
      {categoryDialog && (
        <ProjectCategoryDialog
          state={categoryDialog}
          categories={data.categories}
          assignments={data.projectCategories}
          onClose={() => setCategoryDialog(null)}
          onSaved={refresh}
        />
      )}
      {moveError && !movingChat && (
        <div role="alert" className="pf-error pf-move-notice">
          {moveError}
          <button aria-label={t("Отмена")} onClick={() => setMoveError("")}>
            <Icon name="X" />
          </button>
        </div>
      )}
      {moveNotice && !moveError && (
        <div role="status" className="pf-move-notice">
          <Icon name="FolderSync" />
          {moveNotice}
          <button aria-label={t("Отмена")} onClick={() => setMoveNotice("")}>
            <Icon name="X" />
          </button>
        </div>
      )}
      <Dialog
        open={!!movingChat}
        onOpenChange={(open) => {
          if (!open && !moveBusy) setMovingChat(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Переместить в подраздел…")}</DialogTitle>
            <DialogDescription>
              {movingChat?.title || movingChat?.titleFallback}
            </DialogDescription>
          </DialogHeader>
          <p>
            {t(
              "Выберите подраздел этого проекта. Меняется только место в дереве: чат продолжит работать в своей папке.",
            )}
          </p>
          {moveError && (
            <p role="alert" className="pf-error">
              {moveError}
            </p>
          )}
          <div className="pf-move-targets" aria-busy={moveBusy}>
            {(() => {
              // One tree per project, exactly as the sidebar draws it: a
              // section on another device still hangs under its tree parent.
              const current = movingChat ? place(movingChat) : null;
              const render = (
                folder: Folder,
                root: boolean,
                depth: number,
              ): React.ReactNode => {
                const target = moveTarget(movingChat, folder, root);
                const device = root
                  ? null
                  : foreignHost(data.folders, data.roots, folder)
                    ? deviceName(folder.hostId)
                    : null;
                const blocked = moveBlock(movingChat, folder, root);
                const selected = selectedMove?.folder.id === folder.id;
                return (
                  <div key={folder.id}>
                    <div
                      className="pf-move-tree-row"
                      // A disabled button swallows its own tooltip: the row
                      // carries the reason this destination is refused.
                      title={blocked ?? folder.path}
                      style={{ paddingInlineStart: depth * 18 }}
                    >
                      <button
                        className="pf-icon"
                        aria-label={folder.name}
                        aria-expanded={!moveCollapsed[folder.id]}
                        onClick={() =>
                          setMoveCollapsed((old) => ({
                            ...old,
                            [folder.id]: !old[folder.id],
                          }))
                        }
                      >
                        <Icon
                          name={
                            moveCollapsed[folder.id]
                              ? "ChevronRight"
                              : "ChevronDown"
                          }
                        />
                      </button>
                      <button
                        className={
                          "pf-move-target" + (selected ? " pf-selected" : "")
                        }
                        disabled={moveBusy || !target}
                        onClick={() => {
                          setSelectedMove({ folder, root });
                        }}
                        title={folder.path}
                      >
                        <Icon name="Folder" />
                        <span>{folder.name}</span>
                        {device && (
                          <span className="pf-host-badge">{device}</span>
                        )}
                        {(root ? !current : current === folder.id) && (
                          <span className="pf-host-badge">
                            {t("Сейчас здесь")}
                          </span>
                        )}
                        {selected && <Icon name="Check" />}
                      </button>
                    </div>
                    {!moveCollapsed[folder.id] &&
                      data.folders
                        .filter(
                          (child) =>
                            child.projectId === folder.projectId &&
                            child.parentId === (root ? null : folder.id),
                        )
                        .map((child) => render(child, false, depth + 1))}
                  </div>
                );
              };
              const root = data.roots.find(
                (r) => r.projectId === movingChat?.projectId,
              );
              return root ? render(root, true, 0) : null;
            })()}
          </div>
          {selectedMove && !selectedMove.root && (
            <p className="pf-folder-path">{selectedMove.folder.path}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={moveBusy}
              onClick={() => setMovingChat(null)}
            >
              {t("Отмена")}
            </Button>
            <Button
              disabled={moveBusy || !selectedMove}
              onClick={() => {
                if (movingChat && selectedMove)
                  void moveChat(
                    movingChat,
                    selectedMove.folder,
                    selectedMove.root,
                  );
              }}
            >
              {moveBusy ? t("Перенос чата…") : t("Перенести")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <MoveDialog
        folder={movingProject}
        onClose={() => setMovingProject(null)}
        onMoved={refresh}
      />
      <SectionMoveDialog
        folder={movingSection}
        onClose={() => setMovingSection(null)}
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
    </div>
  );
}
