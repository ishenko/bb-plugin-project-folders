import { ThreadStatus } from "./thread-status";
import { ThreadNotificationsMenu } from "./thread-notifications";
import { t } from "./i18n";
import { memo, useEffect, useState, useRef } from "react";
import {
  useBbNavigate,
  experimental_useSidebarThreadActions,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "./components/ui/dropdown-menu";
import { useTags } from "./tags-store";
import { TagChip, TagPicker } from "./tags-ui";
import { useIsCompactViewport } from "./components/ui/hooks/use-compact-viewport";
import { Input } from "./components/ui/input";
import { Icon } from "./components/ui/icon";
import { ThreadTip } from "./thread-tip";
export function ThreadRow({
  thread,
  active,
  onNavigate,
  onMove,
  onUnplace,
  worksIn,
  onDrag,
}: {
  onMove: (thread: PluginSidebarThread) => void;
  /** Present while the chat is filed somewhere it does not work. */
  onUnplace?: (thread: PluginSidebarThread) => void;
  /** The section the chat actually works in, shown when it sits elsewhere. */
  worksIn?: { label: string; path: string };
  onDrag: (thread: PluginSidebarThread | null) => void;
  thread: PluginSidebarThread;
  active: boolean;
  onNavigate: () => void;
}) {
  const a = experimental_useSidebarThreadActions();
  const nav = useBbNavigate();
  const labels = useTags();
  const tag = labels.tagOf(thread.id);
  const compact = useIsCompactViewport();
  const [picking, setPicking] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const manageLabels = () => {
    setPicking(false);
    nav.toPluginPanel("folders", { subPath: "settings/tags" });
    onNavigate();
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [saving, setSaving] = useState(false);
  const renamePending = useRef(false);
  const cancelled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const beginRename = () => {
    cancelled.current = false;
    setDraft(thread.title || thread.titleFallback || "");
    setRenameError("");
    setMenuOpen(false);
    setEditing(true);
  };
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  const saveRename = async () => {
    if (cancelled.current || renamePending.current) return;
    const title = draft.trim();
    if (!title || title === thread.title) {
      setEditing(false);
      return;
    }
    renamePending.current = true;
    setSaving(true);
    try {
      await a.rename(thread.id, title);
      setEditing(false);
    } catch (error) {
      setRenameError(String(error));
      inputRef.current?.focus();
    } finally {
      renamePending.current = false;
      setSaving(false);
    }
  };
  return (
    <div
      className={"pf-thread " + (active ? "pf-active" : "")}
      data-sidebar-thread-id={thread.id}
      draggable={!editing}
      onDragStart={(event) => {
        if (menuOpen || editing) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData(
          "application/x-bb-project-folders-thread",
          thread.id,
        );
        event.dataTransfer.effectAllowed = "move";
        onDrag(thread);
      }}
      onDragEnd={() => onDrag(null)}
      onContextMenu={(event) => {
        if (editing) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      {editing ? (
        <Input
          ref={inputRef}
          className="pf-thread-rename"
          aria-label={t("Переименовать")}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void saveRename()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void saveRename();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancelled.current = true;
              setEditing(false);
            }
          }}
        />
      ) : (
        <ThreadTip thread={thread}>
          <a
            href={"#" + thread.id}
            data-sidebar-thread-shortcut-target=""
            data-sidebar-thread-id={thread.id}
            onClick={(e) => {
              e.preventDefault();
              a.open(thread.id, { split: e.metaKey || e.ctrlKey });
              onNavigate();
            }}
          >
            <ThreadStatus thread={thread} />
            <span
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                beginRename();
              }}
              className={
                "pf-thread-title" + (thread.isUnread ? " pf-unread" : "")
              }
            >
              {thread.title || thread.titleFallback}
            </span>
            {tag && <TagChip tag={tag} />}
            {worksIn && (
              <span className="pf-host-badge" title={worksIn.path}>
                {worksIn.label}
              </span>
            )}
          </a>
        </ThreadTip>
      )}
      {renameError && (
        <span role="alert" className="text-destructive text-xs">
          {renameError}
        </span>
      )}
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) setNotificationsOpen(false);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button className="pf-icon" aria-label={t("Действия чата")}>
            <Icon name="MoreHorizontal" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (editing) {
              event.preventDefault();
              inputRef.current?.focus();
            }
          }}
        >
          {!(compact && notificationsOpen) && (
            <>
              <DropdownMenuItem onSelect={beginRename}>
                <Icon name="Pencil" />
                {t("Переименовать")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void a.setPinned(thread.id, !thread.isPinned)}
              >
                <Icon name="Pin" />
                {thread.isPinned ? t("Открепить") : t("Закрепить")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void a.setRead(thread.id, thread.isUnread)}
              >
                <Icon name="Check" />
                {thread.isUnread
                  ? t("Отметить прочитанным")
                  : t("Отметить непрочитанным")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onMove(thread)}>
                <Icon name="Folder" />
                {t("Переместить в подраздел…")}
              </DropdownMenuItem>
              {compact || labels.tags.length === 0 ? (
                <DropdownMenuItem
                  onSelect={() =>
                    labels.tags.length === 0 ? manageLabels() : setPicking(true)
                  }
                >
                  <Icon name="Tag" />
                  {labels.tags.length === 0 ? t("Создать метку…") : t("Метка")}
                  {tag && (
                    <span className="pf-tag-menu-current">
                      <TagChip tag={tag} />
                    </span>
                  )}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Icon name="Tag" />
                    {t("Метка")}
                    {tag && (
                      <span className="pf-tag-menu-current">
                        <TagChip tag={tag} />
                      </span>
                    )}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="pf-tag-submenu">
                    <DropdownMenuRadioGroup
                      value={tag?.id ?? ""}
                      onValueChange={(id) =>
                        void labels
                          .setThreadTag(thread.id, id || null)
                          .catch((e) => setRenameError(String(e)))
                      }
                    >
                      <DropdownMenuRadioItem value="">
                        <span className="pf-tag-option-none">
                          {t("Без метки")}
                        </span>
                      </DropdownMenuRadioItem>
                      {labels.tags.map((x) => (
                        <DropdownMenuRadioItem key={x.id} value={x.id}>
                          <TagChip tag={x} />
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={manageLabels}>
                      <Icon name="Settings" />
                      {t("Настроить метки…")}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {onUnplace && (
                <DropdownMenuItem onSelect={() => onUnplace(thread)}>
                  <Icon name="FolderSync" />
                  {t("Вернуть в рабочую папку")}
                </DropdownMenuItem>
              )}
            </>
          )}
          <ThreadNotificationsMenu
            threadId={thread.id}
            parentThreadId={thread.parentThreadId}
            open={menuOpen}
            compactStep={notificationsOpen}
            onStepChange={setNotificationsOpen}
            onClose={() => {
              setMenuOpen(false);
              setNotificationsOpen(false);
            }}
          />
          {!(compact && notificationsOpen) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => a.archive(thread.id)}>
                <Icon name="Archive" />
                {t("В архив")}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => a.requestDelete(thread.id)}
              >
                <Icon name="Trash2" />
                {t("Удалить…")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {picking && (
        <TagPicker
          threadId={thread.id}
          title={thread.title || thread.titleFallback || ""}
          onManage={manageLabels}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
/** Nested values (environment, activity, host) compared by content. */
export function sameThread(a: PluginSidebarThread, b: PluginSidebarThread) {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof PluginSidebarThread)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const x = a[key];
    const y = b[key];
    return (
      x === y ||
      (typeof x === "object" &&
        typeof y === "object" &&
        JSON.stringify(x) === JSON.stringify(y))
    );
  });
}
/**
 * Rows re-render only when their own chat changes: a status change in one chat
 * or opening another must not redraw the hundreds of rows around it.
 */
export const MemoThreadRow = memo(
  ThreadRow,
  (a, b) =>
    a.active === b.active &&
    a.onNavigate === b.onNavigate &&
    a.onMove === b.onMove &&
    a.onDrag === b.onDrag &&
    a.onUnplace === b.onUnplace &&
    a.worksIn?.label === b.worksIn?.label &&
    a.worksIn?.path === b.worksIn?.path &&
    sameThread(a.thread, b.thread),
);
