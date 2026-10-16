import { ChatSortMenu, SectionSortMenu } from "./chat-settings";
import { Glyph, rowDecoration } from "./appearance";
import { t, useLanguage } from "./i18n";
import { useState, type DragEventHandler } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { Folder, rpcContract } from "./server";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./components/ui/dropdown-menu";
import { Icon } from "./components/ui/icon";
import {
  Content as TooltipContent,
  Portal as TooltipPortal,
  Provider as TooltipProvider,
  Root as Tooltip,
  Trigger as TooltipTrigger,
} from "@radix-ui/react-tooltip";
export function formatBytes(bytes: number, language: string): string {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: unit > 0 && value < 10 ? 1 : 0,
  }).format(value);
}
/** The folder's path and, read when the tooltip opens, the space it takes on disk. */
export function FolderPathTip({
  folder,
  children,
}: {
  folder: Folder;
  children: React.ReactElement;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const language = useLanguage();
  const key = `${folder.hostId}\0${folder.path}`;
  const [size, setSize] = useState<{ key: string; bytes: number | null }>();
  const [loading, setLoading] = useState(false);
  const shown = size?.key === key ? size : undefined;
  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip
        onOpenChange={(open) => {
          if (!open) return;
          setLoading(true);
          rpc
            .call("folder_size", { hostId: folder.hostId, path: folder.path })
            .then(
              (r) => setSize({ key, bytes: r.bytes }),
              () => setSize({ key, bytes: null }),
            )
            .finally(() => setLoading(false));
        }}
      >
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipPortal>
          <TooltipContent
            className="pf-tooltip"
            side="bottom"
            align="start"
            sideOffset={2}
            collisionPadding={8}
          >
            <span className="pf-tooltip-path">{folder.path}</span>
            {shown?.bytes != null ? (
              <span className="pf-tooltip-meta">
                {formatBytes(shown.bytes, language)}
              </span>
            ) : (
              loading &&
              !shown && (
                <span className="pf-tooltip-meta" aria-label={t("Загрузка…")}>
                  …
                </span>
              )
            )}
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
}
/** GitHub's own visibility labels, untranslated as on github.com. */
export const VISIBILITY_LABELS = {
  public: "Public",
  private: "Private",
  internal: "Internal",
} as const;
export function GithubLink({ url, folder }: { url: string; folder: Folder }) {
  const git = folder.git;
  const dirty = !!git && git.changes > 0;
  const visibility = folder.githubVisibility;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            className={
              "pf-icon pf-github" +
              (folder.githubPrivate ? " pf-github-private" : "")
            }
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={
              (folder.githubPrivate
                ? t("Открыть приватный репозиторий GitHub")
                : t("Открыть репозиторий GitHub")) +
              (dirty ? `, ${t("Незакоммиченные изменения")}` : "")
            }
            onClick={(event) => event.stopPropagation()}
          >
            <Icon name="GithubLogo" />
            {dirty && <span className="pf-git-dot" aria-hidden />}
          </a>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent
            className="pf-tooltip pf-tooltip-stack"
            side="bottom"
            align="end"
            sideOffset={4}
            collisionPadding={8}
          >
            <span className="pf-tooltip-line">
              <span className="pf-tooltip-repo">
                {url.replace(/^https:\/\/github\.com\//i, "")}
              </span>
              {/* null: not checked yet, or gh and the anonymous API both failed. */}
              {visibility && (
                <span className="pf-tooltip-meta">
                  {visibility === "missing"
                    ? t("Нет доступа")
                    : VISIBILITY_LABELS[visibility]}
                </span>
              )}
            </span>
            {git?.branch && (
              <span className="pf-tooltip-line pf-tooltip-git">
                <Icon name="GitBranch" />
                <span className="pf-tooltip-repo">{git.branch}</span>
                {git.upstream && (git.ahead > 0 || git.behind > 0) && (
                  <span className="pf-tooltip-meta">
                    {[
                      git.ahead > 0 ? `↑${git.ahead}` : "",
                      git.behind > 0 ? `↓${git.behind}` : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </span>
                )}
                {dirty && (
                  <span className="pf-tooltip-meta pf-tooltip-dirty">
                    {t("Изменений")}: {git.changes}
                  </span>
                )}
              </span>
            )}
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
}
export function FolderHeading({
  folder,
  root,
  closed,
  empty = false,
  unread = false,
  highlighted,
  refused = false,
  rulesAllowed,
  look,
  group = false,
  device,
  onAppearance,
  onNewGroup,
  onMoveToGroup,
  onDeleteGroup,
  onToggle,
  onNewChat,
  onDragOver,
  onDragLeave,
  onDrop,
  onNewProject,
  onCreate,
  onConfigure,
  onMove,
  onRules,
  onRename,
  onRelocate,
  onRemove,
  onArchive,
  hidden = false,
  onToggleHidden,
}: {
  folder: Folder;
  root: boolean;
  /** Hidden from the tree; drawn only while «Show hidden» is on. */
  hidden?: boolean;
  onToggleHidden?: () => void;
  closed: boolean;
  /** No sections and no chats: nothing to open, so no disclosure chevron. */
  empty?: boolean;
  unread?: boolean;
  highlighted: boolean;
  /** The highlighted row refuses this chat: shown, but not as a promise. */
  refused?: boolean;
  rulesAllowed: boolean;
  look: {
    icon: string;
    color?: string;
    fill: "none" | "badge" | "stripe" | "row";
  };
  group?: boolean;
  /** Shown next to the name when the section lives on another device. */
  device?: string;
  onAppearance: () => void;
  onNewGroup: () => void;
  onMoveToGroup?: () => void;
  onDeleteGroup: () => void;
  onToggle: () => void;
  onNewChat: () => void;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDragLeave: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
  onNewProject: () => void;
  onCreate: () => void;
  onConfigure: () => void;
  onMove: () => void;
  onRules: () => void;
  onRename: () => void;
  onRelocate: () => void;
  onRemove: () => void;
  onArchive: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const row = rowDecoration(look);
  return (
    <div
      className={
        "pf-heading" +
        row.className +
        (highlighted ? " pf-drop-target" : "") +
        (highlighted && refused ? " pf-drop-refused" : "")
      }
      style={row.style}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen(true);
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {(() => {
        const label = (
          <button
            className={"pf-label" + (unread ? " pf-unread" : "")}
            onClick={onToggle}
          >
            {empty ? (
              <span className="pf-chevron pf-chevron-spacer" aria-hidden />
            ) : (
              <Icon
                name={closed ? "ChevronRight" : "ChevronDown"}
                className="pf-chevron"
              />
            )}
            <Glyph {...look} />
            <span>{folder.name}</span>
            {device && <span className="pf-host-badge">{device}</span>}
          </button>
        );
        return group ? (
          label
        ) : (
          <FolderPathTip folder={folder}>{label}</FolderPathTip>
        );
      })()}
      {!group && folder.githubUrl && (
        <GithubLink url={folder.githubUrl} folder={folder} />
      )}
      {!group && (
        <button
          className="pf-icon"
          title={t("Новый чат")}
          aria-label={`${t("Новый чат")}: ${folder.name}`}
          onClick={onNewChat}
        >
          <Icon name="MessageCirclePlus" />
        </button>
      )}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="pf-icon"
            aria-label={`${t("Действия чата")}: ${folder.name}`}
          >
            <Icon name="MoreHorizontal" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {root && (
            <DropdownMenuItem onSelect={onNewProject}>
              <Icon name="FolderPlus" />
              {t("Новый проект")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onCreate}>
            <Icon name="SectionAdd" />
            {t("Новый раздел")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onNewGroup}>
            <Icon name="Layers" />
            {t("Новая группа")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onConfigure}>
            <Icon name="SlidersHorizontal" />
            {t("Настройка")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onAppearance}>
            <Icon name="Palette" />
            {t("Оформление")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <ChatSortMenu />
          <SectionSortMenu />
          {root && (
            <DropdownMenuItem onSelect={onMove}>
              <Icon name="Folder" />
              {t("Перенести")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {rulesAllowed && (
            <DropdownMenuItem onSelect={onRules}>
              <Icon name="Settings" />
              {t("Правила работы")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onRename}>
            <Icon name="Edit" />
            {t("Переименовать")}
          </DropdownMenuItem>
          {onToggleHidden && (
            <DropdownMenuItem onSelect={onToggleHidden}>
              <Icon name={hidden ? "Eye" : "EyeOff"} />
              {hidden ? t("Показать в дереве") : t("Скрыть из дерева")}
            </DropdownMenuItem>
          )}
          {onMoveToGroup && (
            <DropdownMenuItem onSelect={onMoveToGroup}>
              <Icon name="MoveTo" />
              {t("Переместить в группу…")}
            </DropdownMenuItem>
          )}
          {!root && !group && (
            <DropdownMenuItem onSelect={onRelocate}>
              <Icon name="FolderExport" />
              {t("Изменить путь")}
            </DropdownMenuItem>
          )}
          {root && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                <Icon name="Trash2" />
                {t("Удалить")}
              </DropdownMenuItem>
            </>
          )}
          {!root && (
            <>
              <DropdownMenuSeparator />
              {group ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={onDeleteGroup}
                >
                  <Icon name="Trash2" />
                  {t("Удалить группу")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem variant="destructive" onSelect={onArchive}>
                  <Icon name="Trash2" />
                  {t("Удалить")}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
