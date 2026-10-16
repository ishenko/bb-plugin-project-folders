import { FolderBrowser } from "./folder-browser";
import { RuleFields, type RuleDraft } from "./agents-apply";
import { t, direction } from "./i18n";
import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { Folder, rpcContract } from "./server";
import type { Archive } from "./archive";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./components/ui/dropdown-menu";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Icon } from "./components/ui/icon";
import { type Modal, isGroupFolder, reparentTargets } from "./tree-model";
export function MoveToGroupDialog({
  folder,
  folders,
  roots,
  onClose,
  onMoved,
}: {
  folder: Folder | null;
  folders: readonly Folder[];
  roots: readonly Folder[];
  onClose: () => void;
  onMoved: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [choice, setChoice] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setChoice(undefined);
    setError("");
  }, [folder?.id]);
  if (!folder) return null;
  const targets = reparentTargets(folders, folder, roots);
  const save = async () => {
    if (choice === undefined) return;
    setBusy(true);
    setError("");
    try {
      await rpc.call("section_reparent", {
        folderId: folder.id,
        parentId: choice,
      });
      onMoved();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="pf-dialog" dir={direction()}>
        <DialogHeader>
          <DialogTitle>{t("Переместить в группу")}</DialogTitle>
          <DialogDescription>{folder.name}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t(
            "Меняется только место в дереве: папка, файлы и чаты остаются на месте.",
          )}
        </p>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        {targets.length === 0 ? (
          <p className="text-sm">
            {t("Подходящих групп нет. Создайте группу рядом с этим разделом.")}
          </p>
        ) : (
          <div className="pf-reparent-list" role="radiogroup">
            {targets.map((target) => (
              <label key={target.id ?? "root"} className="pf-reparent-option">
                <input
                  type="radio"
                  name="pf-reparent"
                  checked={choice === target.id}
                  onChange={() => setChoice(target.id)}
                />
                <Icon
                  name={
                    target.id &&
                    isGroupFolder(folders.find((x) => x.id === target.id))
                      ? "Layers"
                      : "Folder"
                  }
                />
                <span>{target.label ?? t("Корень проекта")}</span>
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("Отмена")}
          </Button>
          <Button
            disabled={busy || choice === undefined}
            onClick={() => void save()}
          >
            {busy ? t("Сохраняю…") : t("Переместить")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function FolderDialog({
  modal,
  onClose,
  onCreated,
}: {
  modal: Modal | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [hostId, setHostId] = useState("");
  const [locations, setLocations] = useState<
    {
      hostId: string;
      name: string;
      path: string | null;
      available: boolean;
      reason: string | null;
    }[]
  >([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const selectedLocation = locations.find((l) => l.hostId === hostId);
  const folderPath =
    modal?.action === "create"
      ? (selectedLocation?.path ?? modal.folder.path)
      : modal?.folder.path;
  const [matches, setMatches] = useState<Archive[]>([]);
  const [name, setName] = useState("");
  const [relative, setRelative] = useState("");
  const [picked, setPicked] = useState(false);
  /** The absolute folder open in the picker; null while the form is shown. */
  const [browse, setBrowse] = useState<string | null>(null);
  const [listing, setListing] = useState<{
    path: string;
    parent: string | null;
    directories: { name: string; path: string }[];
  } | null>(null);
  const [content, setContent] = useState("");
  const [claude, setClaude] = useState<string | null>(null);
  const [sha, setSha] = useState<string | null>(null);
  const [dialogRules, setDialogRules] = useState<RuleDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [projectFiles, setProjectFiles] = useState<"keep" | "archive">("keep");
  const [sectionMode, setSectionMode] = useState<
    "archive" | "unbind" | "purge"
  >("unbind");
  /** Rules tabs: which device's copy of the project root is being edited. */
  const [rulesHost, setRulesHost] = useState<string | null>(null);
  const [machines, setMachines] = useState<
    { id: string; name: string; connected: boolean }[]
  >([]);
  const ruleCopies =
    modal?.action === "rules" && !modal.target.folderId
      ? (modal.copies ?? [modal.folder])
      : null;
  const machineName = (id: string) =>
    machines.find((m) => m.id === id)?.name ?? id;
  useEffect(() => {
    setHostId(modal?.folder.hostId ?? "");
    setLocations([]);
    setLocationsLoading(modal?.action === "create");
    let live = true;
    if (modal?.action === "rules" && !modal.target.folderId)
      rpc.call("machines").then(
        (r) => live && setMachines(r.machines),
        () => {},
      );
    if (modal?.action === "create")
      rpc.call("locations", modal.target).then(
        (r) => {
          if (live) {
            setLocations(r.locations);
            setLocationsLoading(false);
          }
        },
        (e) => {
          if (live) {
            setError(String(e));
            setLocationsLoading(false);
          }
        },
      );
    setName(modal?.action === "rename" ? modal.folder.name : "");
    setRelative("");
    setPicked(false);
    setBrowse(null);
    setError("");
    setContent("");
    setClaude(null);
    setDialogRules(null);
    setProjectFiles("keep");
    setSectionMode("unbind");
    setLoading(false);
    // Root rules wait for the rules tab (rulesHost); sections load right away.
    if (
      modal?.action === "rules" &&
      (modal.target.folderId || rulesHost !== null)
    ) {
      setLoading(true);
      rpc
        .call("rules_read", {
          ...modal.target,
          ...(rulesHost ? { hostId: rulesHost } : {}),
        })
        .then(
          (r) => {
            setContent(r.content);
            setClaude(r.claude);
            setSha(r.sha);
            setDialogRules({
              mode: r.mode,
              sectionTemplate: r.template || r.suggestedSection,
              projectTemplate: r.projectTemplate || r.suggestedProject,
              custom: r.custom,
              customTarget: r.customTarget,
              startup: r.startup,
            });
            setLoading(false);
          },
          (e) => {
            setError(String(e));
            setLoading(false);
          },
        );
    }
    return () => {
      live = false;
    };
  }, [modal, rpc, rulesHost]);
  useEffect(() => {
    setRulesHost(
      modal?.action === "rules" && !modal.target.folderId
        ? (modal.rulesHost ?? modal.folder.hostId)
        : null,
    );
  }, [modal]);
  useEffect(() => {
    if (browse === null || !modal || !hostId) return;
    let live = true;
    setLoading(true);
    setListing(null);
    rpc.call("project_browse", { hostId, path: browse }).then(
      (r) => {
        if (live) {
          setListing(r);
          setError("");
          setLoading(false);
        }
      },
      (e) => {
        if (live) {
          setError(String(e));
          setLoading(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [browse, modal, rpc, hostId]);
  const base = (folderPath ?? "").replace(/\/$/, "");
  /** A picked folder inside the parent is kept relative; any other is absolute. */
  const pickedPath = (p: string) =>
    p.startsWith(base + "/") ? p.slice(base.length + 1) : p;
  const sectionPath =
    picked && relative.startsWith("/")
      ? relative
      : base + "/" + (picked ? relative : name);
  const save = async (allowFresh = false) => {
    if (!modal) return;
    setBusy(true);
    setError("");
    try {
      if (modal.action === "create") {
        if (!allowFresh) {
          const found = await rpc.call("archive_matches", {
            ...modal.target,
            hostId,
            name,
            relativePath: picked ? relative : name,
          });
          if (found.archives.length) {
            setMatches(found.archives);
            return;
          }
        }
        await rpc.call("create", {
          ...modal.target,
          hostId,
          name,
          relativePath: picked ? relative : name,
          allowFresh,
        });
      } else if (modal.action === "group")
        await rpc.call("group_create", { ...modal.target, name });
      else if (modal.action === "rename")
        await rpc.call("rename", { ...modal.target, name });
      else if (modal.action === "forget") {
        if (!modal.target.folderId) throw new Error("Section not found.");
        await rpc.call("section_remove", {
          folderId: modal.target.folderId,
          mode: sectionMode,
        });
      } else if (modal.action === "remove")
        await rpc.call("project_delete", {
          projectId: modal.target.projectId,
          files: projectFiles,
        });
      else {
        const at = {
          ...modal.target,
          ...(rulesHost ? { hostId: rulesHost } : {}),
        };
        await rpc.call("rules_save", {
          ...at,
          content,
          sha,
        });
        if (claude !== null)
          await rpc.call("rules_save", {
            ...at,
            content: claude,
            sha: null,
            file: "CLAUDE.md",
          });
        if (dialogRules)
          await rpc.call("rules_settings_save", {
            projectId: modal.target.projectId,
            folderId: modal.target.folderId,
            mode: dialogRules.mode,
            sectionTemplate: dialogRules.sectionTemplate,
            projectTemplate: dialogRules.projectTemplate,
            custom: dialogRules.custom,
            customTarget: dialogRules.customTarget,
            startup: dialogRules.startup,
          });
      }
      onCreated();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => setMatches([]), [name, relative, hostId, picked, modal]);
  const restoreMatch = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await rpc.call("restore", { id });
      onCreated();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const title =
    browse !== null
      ? t("Выбор папки")
      : modal?.action === "create"
        ? t("Новый раздел")
        : modal?.action === "group"
          ? t("Новая группа")
          : modal?.action === "rules"
            ? t("Правила работы")
            : modal?.action === "rename"
              ? t("Переименовать")
              : modal?.action === "remove"
                ? t("Удалить проект")
                : t("Удалить раздел");
  return (
    <Dialog
      open={!!modal}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="pf-dialog" dir={direction()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{modal?.folder.name}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        {modal?.action === "create" && (
          <label className="pf-field">
            {t("Устройство")}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 w-full justify-between"
                  disabled={busy || locationsLoading}
                >
                  <span className="flex items-center gap-2">
                    <Icon name="Monitor" />
                    {locationsLoading
                      ? t("Загрузка устройств…")
                      : (selectedLocation?.name ?? t("Выберите устройство"))}
                  </span>
                  <Icon name="ChevronDown" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {locations.map((l) => (
                  <DropdownMenuItem
                    key={l.hostId}
                    disabled={!l.available}
                    onSelect={() => {
                      setHostId(l.hostId);
                      setBrowse(null);
                      setRelative("");
                      setPicked(false);
                      setError("");
                    }}
                  >
                    <Icon name="Monitor" />
                    <span>
                      {l.name}
                      {l.reason && (
                        <span className="block text-xs text-muted-foreground">
                          {l.reason}
                        </span>
                      )}
                    </span>
                    {hostId === l.hostId && <Icon name="Check" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </label>
        )}
        {browse !== null ? (
          <>
            <FolderBrowser
              key={hostId + browse}
              hostId={hostId}
              path={listing?.path ?? browse}
              parent={
                listing
                  ? listing.parent
                  : browse.replace(/\/[^/]*\/?$/, "") ||
                    (browse === "/" ? null : "/")
              }
              directories={listing?.directories ?? []}
              loading={loading || busy}
              navigate={setBrowse}
              refresh={() => {
                setLoading(true);
                void rpc
                  .call("project_browse", { hostId, path: browse })
                  .then(setListing, (e) => setError(String(e)))
                  .finally(() => setLoading(false));
              }}
              onBusyChange={setBusy}
            />
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setBrowse(null)}
              >
                {t("Назад")}
              </Button>
              <Button
                disabled={busy || loading || !listing}
                onClick={() => {
                  if (!listing) return;
                  setRelative(pickedPath(listing.path));
                  setPicked(true);
                  if (!name) setName(listing.path.split("/").at(-1) || "");
                  setBrowse(null);
                }}
              >
                {t("Выбрать папку")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(matches.length > 0);
            }}
          >
            {matches.length > 0 && (
              <div className="rounded-lg border p-3 mb-4">
                <p className="font-medium mb-2">
                  {t("В архиве найден раздел с таким названием")}
                </p>
                {matches.map((a) => (
                  <div key={a.id} className="mb-3">
                    <p>
                      {a.folder.name} ·{" "}
                      {new Date(a.createdAt).toLocaleDateString()}
                    </p>
                    <p className="pf-folder-path">{a.folder.path}</p>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => void restoreMatch(a.id)}
                    >
                      <Icon name="Archive" />
                      {t("Восстановить с историей")}
                    </Button>
                  </div>
                ))}
                <p className="text-sm text-muted-foreground">
                  {t(
                    "Восстановление вернёт прежнюю папку, правила, вложенные разделы и чаты на исходное место.",
                  )}
                </p>
              </div>
            )}
            {modal?.action === "group" && (
              <p className="text-sm text-muted-foreground mb-3">
                {t(
                  "Группа объединяет разделы в дереве и не создаёт папку. Разделы внутри неё создаются в ближайшей папке выше.",
                )}{" "}
                {t(
                  "Разделы внутри группы можно создавать на любом устройстве, где у проекта есть папка.",
                )}
              </p>
            )}
            {(modal?.action === "create" ||
              modal?.action === "rename" ||
              modal?.action === "group") && (
              <label className="pf-field">
                {t(
                  modal?.action === "rename" && !modal.target.folderId
                    ? "Название проекта"
                    : modal?.action === "group" ||
                        (modal?.action === "rename" &&
                          isGroupFolder(modal.folder))
                      ? "Название группы"
                      : "Название раздела",
                )}
                <Input
                  autoFocus
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            {modal?.action === "create" && (
              <>
                <label className="pf-field">
                  {t("Папка")}
                  <div className="pf-path-control">
                    <Input
                      readOnly
                      value={sectionPath}
                      aria-label={t("Папка раздела")}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={t("Выбрать папку")}
                      disabled={!selectedLocation?.path}
                      onClick={() => {
                        setListing(null);
                        setBrowse(base);
                      }}
                    >
                      <Icon name="Folder" />
                    </Button>
                  </div>
                </label>
                <p className="text-sm text-muted-foreground mb-4">
                  {t(
                    "Новая папка создастся по названию раздела. Кнопка папки позволяет выбрать существующую.",
                  )}{" "}
                  {t("Разные разделы могут указывать на одну папку.")}{" "}
                  {t(
                    "Папку можно выбрать и вне проекта, например папку сайта на сервере.",
                  )}
                </p>
                {picked && (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setPicked(false);
                      setRelative("");
                    }}
                  >
                    {t("Создать новую папку по названию")}
                  </Button>
                )}
              </>
            )}
            {modal?.action === "rules" && (
              <>
                {ruleCopies && ruleCopies.length > 1 && (
                  <div
                    className="pf-tabs"
                    role="tablist"
                    aria-label={t("Устройство")}
                  >
                    {ruleCopies.map((c) => (
                      <button
                        key={`${c.projectId}:${c.hostId}`}
                        type="button"
                        role="tab"
                        aria-selected={rulesHost === c.hostId}
                        className={
                          "pf-tab" +
                          (rulesHost === c.hostId ? " pf-selected" : "") +
                          (machines.find((m) => m.id === c.hostId)?.connected
                            ? " pf-tab-live"
                            : "")
                        }
                        title={c.path}
                        disabled={busy}
                        onClick={() => setRulesHost(c.hostId)}
                      >
                        <Icon name="Zap" />
                        {machineName(c.hostId)}
                      </button>
                    ))}
                  </div>
                )}
                {dialogRules && (
                  <div className="pf-agents-override">
                    <RuleFields
                      draft={dialogRules}
                      onChange={(patch) =>
                        setDialogRules({ ...dialogRules, ...patch })
                      }
                      showProject={!modal.target.folderId}
                      namePrefix="pf-dialog"
                      fileSlot={
                        loading ? (
                          <p className="pf-agents-hint">{t("Загрузка…")}</p>
                        ) : (
                          <div className="pf-file-editors">
                            <p className="pf-folder-path">
                              {ruleCopies?.find((c) => c.hostId === rulesHost)
                                ?.path ?? modal.folder.path}
                            </p>
                            <textarea
                              className="pf-rules"
                              aria-label={t("Содержимое AGENTS.md")}
                              rows={10}
                              value={content}
                              onChange={(e) => setContent(e.target.value)}
                            />
                            {claude !== null && (
                              <label className="pf-field">
                                CLAUDE.md
                                <textarea
                                  className="pf-rules"
                                  aria-label="CLAUDE.md"
                                  rows={8}
                                  value={claude}
                                  onChange={(e) => setClaude(e.target.value)}
                                />
                              </label>
                            )}
                          </div>
                        )
                      }
                    />
                    <p className="pf-agents-hint">
                      {t(
                        "Сохранение вписывает свои правила вниз AGENTS.md и CLAUDE.md, если он есть.",
                      )}
                    </p>
                  </div>
                )}
              </>
            )}
            {modal?.action === "forget" && (
              <fieldset className="pf-choices">
                {(
                  [
                    {
                      mode: "unbind" as const,
                      icon: "EyeOff" as const,
                      title: t("Убрать из дерева"),
                      hint: t(
                        "Папка на диске останется. Раздел пропадёт из дерева вместе с чатами, которые в нём открывались. Эти чаты уйдут в архив чатов BB.",
                      ),
                    },
                    {
                      mode: "archive" as const,
                      icon: "Archive" as const,
                      title: t("В архив проекта"),
                      hint: t(
                        "Папка, вложенные разделы и история переедут в скрытый архив. Чаты тоже архивируются. Потом можно восстановить.",
                      ),
                    },
                    {
                      mode: "purge" as const,
                      icon: "Trash2" as const,
                      title: t("Удалить полностью"),
                      hint: t(
                        "Раздел и его чаты исчезнут безвозвратно. Папка на диске удалится, если её не делит другой раздел и внутри нет другого проекта BB.",
                      ),
                      danger: true,
                    },
                  ] as const
                ).map((choice) => (
                  <label
                    key={choice.mode}
                    className={
                      "pf-choice" +
                      (sectionMode === choice.mode ? " pf-choice-on" : "") +
                      ("danger" in choice && choice.danger
                        ? " pf-choice-danger"
                        : "")
                    }
                  >
                    <span className="pf-choice-head">
                      <input
                        type="radio"
                        name="section-remove"
                        checked={sectionMode === choice.mode}
                        onChange={() => setSectionMode(choice.mode)}
                      />
                      <Icon name={choice.icon} />
                      <span className="pf-choice-title">{choice.title}</span>
                    </span>
                    <span className="pf-choice-hint">{choice.hint}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {modal?.action === "remove" && (
              <fieldset className="mb-4 space-y-3">
                <p className="text-sm">
                  {t(
                    "Проект пропадёт из дерева BB. Его чаты будут удалены из BB. Это нельзя отменить из плагина.",
                  )}
                </p>
                <label className="pf-field">
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="project-files"
                      checked={projectFiles === "keep"}
                      onChange={() => setProjectFiles("keep")}
                    />
                    {t("Не трогать файлы")}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t("Папки проекта на всех устройствах останутся на месте.")}
                  </span>
                </label>
                <label className="pf-field">
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="project-files"
                      checked={projectFiles === "archive"}
                      onChange={() => setProjectFiles("archive")}
                    />
                    {t("Перенести файлы в архив")}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t(
                      "Каждая копия папки переедет в скрытый архив рядом с ней, в .bb/archive/projects/.",
                    )}
                  </span>
                </label>
              </fieldset>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("Отмена")}
              </Button>
              <Button
                type="submit"
                variant={
                  modal?.action === "remove" ||
                  (modal?.action === "forget" && sectionMode === "purge")
                    ? "destructive"
                    : "default"
                }
                disabled={
                  busy ||
                  loading ||
                  (modal?.action === "create" &&
                    (locationsLoading || !selectedLocation?.available))
                }
              >
                {busy
                  ? t("Сохраняю…")
                  : modal?.action === "group"
                    ? t("Создать")
                    : modal?.action === "create"
                      ? matches.length
                        ? t("Создать новый, не восстанавливая")
                        : t("Создать")
                      : modal?.action === "forget"
                        ? sectionMode === "unbind"
                          ? t("Убрать из дерева")
                          : sectionMode === "purge"
                            ? t("Удалить полностью")
                            : t("Архивировать")
                        : modal?.action === "remove"
                          ? t("Удалить")
                          : t("Сохранить")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function ProjectDialog({
  open,
  onClose,
  onCreated,
  defaultHostId,
}: {
  open: boolean;
  defaultHostId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [hosts, setHosts] = useState<
    { id: string; name: string; connected: boolean }[]
  >([]);
  const [hostId, setHostId] = useState("");
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  /** Open folder browser: null = closed, copyHost = picking for that copy's row. */
  const [browse, setBrowse] = useState(false);
  const [listing, setListing] = useState<{
    path: string;
    parent: string | null;
    directories: { name: string; path: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    setError("");
    setName("");
    setChosen(null);
    setBrowse(false);
    setHostId("");
    rpc.call("machines").then(
      (r) => {
        if (live) {
          setHosts(r.machines);
          setHostId(
            r.machines.find((h) => h.connected && h.id === defaultHostId)?.id ??
              r.machines.find((h) => h.connected)?.id ??
              "",
          );
        }
      },
      (e) => {
        if (live) setError(String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [open, rpc, defaultHostId]);
  useEffect(() => {
    if (!open || !hostId) return;
    let live = true;
    setChosen(null);
    setBase("");
    setBrowse(false);
    setLoading(true);
    rpc.call("project_browse", { hostId }).then(
      (r) => {
        if (live) {
          setBase(r.path);
          setListing(r);
          setLoading(false);
        }
      },
      (e) => {
        if (live) {
          setError(String(e));
          setLoading(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [open, hostId, rpc]);
  const enter = async (path: string) => {
    setLoading(true);
    setError("");
    try {
      setListing(await rpc.call("project_browse", { hostId, path }));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await rpc.call("project_create", {
        hostId,
        name,
        path: chosen ?? base.replace(/\/$/, "") + "/" + name,
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent className="pf-dialog" dir={direction()}>
        <DialogHeader>
          <DialogTitle>
            {browse ? t("Выбор папки") : t("Новый проект")}
          </DialogTitle>
          <DialogDescription>
            {t("Устройство и рабочая папка проекта")}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <label className="pf-field">
          {t("Устройство")}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="mt-2 w-full justify-between"
                disabled={busy || loading}
              >
                <span className="flex items-center gap-2">
                  <Icon name="Monitor" />
                  {hosts.find((h) => h.id === hostId)?.name ?? t("Загрузка…")}
                </span>
                <Icon name="ChevronDown" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {hosts.map((h) => (
                <DropdownMenuItem
                  key={h.id}
                  disabled={!h.connected}
                  onSelect={() => setHostId(h.id)}
                >
                  <Icon name="Monitor" />
                  {h.name}
                  {!h.connected ? t("— не подключено") : ""}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </label>
        {browse ? (
          <>
            {listing && (
              <FolderBrowser
                key={hostId + listing.path}
                hostId={hostId}
                path={listing.path}
                parent={listing.parent}
                directories={listing.directories}
                loading={loading || busy}
                navigate={(p) => void enter(p)}
                refresh={() => void enter(listing.path)}
                onBusyChange={setBusy}
              />
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setBrowse(false)}
              >
                {t("Назад")}
              </Button>
              <Button
                disabled={busy || loading || !listing}
                onClick={() => {
                  setChosen(listing!.path);
                  if (!name) setName(listing!.path.split("/").at(-1) ?? "");
                  setBrowse(false);
                }}
              >
                {t("Выбрать папку")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="pf-field">
              {t("Название проекта")}
              <Input
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="pf-field">
              {t("Папка")}
              <div className="pf-path-control">
                <Input
                  aria-label={t("Папка проекта")}
                  required
                  value={
                    chosen ?? (base ? base.replace(/\/$/, "") + "/" + name : "")
                  }
                  onChange={(e) => setChosen(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading || !hostId}
                  aria-label={t("Выбрать папку")}
                  onClick={() => setBrowse(true)}
                >
                  <Icon name="Folder" />
                </Button>
              </div>
            </label>
            <p className="text-sm text-muted-foreground mb-4">
              {t(
                "Можно выбрать существующую папку или указать новую — она будет создана на выбранном устройстве.",
              )}
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("Отмена")}
              </Button>
              <Button disabled={busy || loading || !hostId || !base}>
                {busy ? t("Создаю…") : t("Создать проект")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function CopiesDialog({
  root,
  presetHost,
  onClose,
  onChanged,
  onRelocate,
}: {
  root: Folder | null;
  /** Opens with this device already chosen in the "add a copy" form. */
  presetHost?: string | null;
  onClose: () => void;
  onChanged: () => void;
  /** Hands a copy over to the folder picker of the move dialog. */
  onRelocate: (copy: Folder) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [machines, setMachines] = useState<
    { id: string; name: string; connected: boolean }[]
  >([]);
  const [copies, setCopies] = useState<Folder[]>([]);
  const [hostId, setHostId] = useState("");
  const [base, setBase] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [browse, setBrowse] = useState(false);
  const [listing, setListing] = useState<{
    path: string;
    parent: string | null;
    directories: { name: string; path: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmHost, setConfirmHost] = useState<string | null>(null);
  const load = useCallback(() => {
    rpc.call("machines").then(
      (r) => setMachines(r.machines),
      (e) => setError(String(e)),
    );
    if (root)
      rpc.call("list").then(
        (r) => setCopies(r.roots.filter((x) => x.projectId === root.projectId)),
        () => {},
      );
  }, [rpc, root]);
  useEffect(() => {
    if (!root) return;
    setHostId(presetHost ?? "");
    setChosen(null);
    setBrowse(false);
    setError("");
    setConfirmHost(null);
    load();
  }, [root, presetHost, load]);
  useEffect(() => {
    if (!root || !hostId) return;
    let live = true;
    setChosen(null);
    setBrowse(false);
    setLoading(true);
    rpc.call("project_browse", { hostId }).then(
      (r) => {
        if (live) {
          setBase(r.path);
          setListing(r);
          setLoading(false);
        }
      },
      (e) => {
        if (live) {
          setError(String(e));
          setLoading(false);
        }
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, hostId, rpc]);
  const enter = async (p: string) => {
    setLoading(true);
    setError("");
    try {
      setListing(await rpc.call("project_browse", { hostId, path: p }));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  const add = async () => {
    if (!root || !hostId) return;
    setBusy(true);
    setError("");
    try {
      await rpc.call("copy_add", {
        projectId: root.projectId,
        hostId,
        path: chosen ?? base,
      });
      setHostId("");
      setChosen(null);
      onChanged();
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (host: string) => {
    if (!root) return;
    setBusy(true);
    setError("");
    try {
      await rpc.call("copy_remove", {
        projectId: root.projectId,
        hostId: host,
      });
      setConfirmHost(null);
      onChanged();
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const free = machines.filter(
    (m) => m.connected && !copies.some((c) => c.hostId === m.id),
  );
  const name = (id: string) => machines.find((m) => m.id === id)?.name ?? id;
  return (
    <Dialog
      open={!!root}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="pf-dialog" dir={direction()}>
        <DialogHeader>
          <DialogTitle>
            {browse ? t("Выбор папки") : t("Рабочие копии")}
          </DialogTitle>
          <DialogDescription>
            {t("У проекта может быть своя рабочая папка на каждом устройстве.")}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {browse ? (
          <>
            {listing && (
              <FolderBrowser
                key={hostId + listing.path}
                hostId={hostId}
                path={listing.path}
                parent={listing.parent}
                directories={listing.directories}
                loading={loading || busy}
                navigate={(p) => void enter(p)}
                refresh={() => void enter(listing.path)}
                onBusyChange={setBusy}
              />
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setBrowse(false)}
              >
                {t("Назад")}
              </Button>
              <Button
                disabled={busy || loading || !listing}
                onClick={() => {
                  setChosen(listing!.path.replace(/\/$/, ""));
                  setBrowse(false);
                }}
              >
                {t("Выбрать папку")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="pf-copies">
            <p className="text-sm text-muted-foreground">
              {t(
                "Папка копии на устройстве. Кнопка рядом с путём открывает выбор папки: проект можно перенести в новую папку или привязать к существующей.",
              )}
            </p>
            {copies.map((c) => (
              <div key={`${c.projectId}:${c.hostId}`} className="pf-copy-row">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    <Icon
                      name="Zap"
                      className={
                        machines.find((m) => m.id === c.hostId)?.connected
                          ? "pf-bolt-live"
                          : ""
                      }
                    />
                    {name(c.hostId)}
                  </p>
                  <div className="pf-path-control">
                    <Input
                      readOnly
                      aria-label={`${t("Папка проекта")} — ${name(c.hostId)}`}
                      value={c.path}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      aria-label={t("Выбрать папку")}
                      onClick={() => onRelocate(c)}
                    >
                      <Icon name="Folder" />
                    </Button>
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-1">
                  {confirmHost === c.hostId ? (
                    <>
                      <Button
                        variant="destructive"
                        disabled={busy}
                        onClick={() => void remove(c.hostId)}
                      >
                        {t("Убрать")}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setConfirmHost(null)}
                      >
                        {t("Отмена")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled={busy || copies.length <= 1}
                      onClick={() => setConfirmHost(c.hostId)}
                    >
                      <Icon name="Trash2" />
                      {t("Убрать")}
                    </Button>
                  )}
                </span>
              </div>
            ))}
            <form
              className="pf-copy-add"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <label className="pf-field">
                {t("Добавить копию на устройстве")}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2 w-full justify-between"
                      disabled={busy || loading}
                    >
                      <span className="flex items-center gap-2">
                        <Icon name="Monitor" />
                        {free.find((m) => m.id === hostId)?.name ??
                          t("Выберите устройство")}
                      </span>
                      <Icon name="ChevronDown" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {free.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onSelect={() => setHostId(m.id)}
                      >
                        <Icon name="Monitor" />
                        {m.name}
                      </DropdownMenuItem>
                    ))}
                    {!free.length && (
                      <DropdownMenuItem disabled>
                        {t("Все подключённые устройства уже заняты.")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </label>
              {hostId && (
                <label className="pf-field">
                  {t("Папка")}
                  <div className="pf-path-control">
                    <Input
                      aria-label={t("Папка проекта")}
                      required
                      value={chosen ?? base}
                      onChange={(e) => setChosen(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={loading}
                      aria-label={t("Выбрать папку")}
                      onClick={() => setBrowse(true)}
                    >
                      <Icon name="Folder" />
                    </Button>
                  </div>
                </label>
              )}
              <p className="text-sm text-muted-foreground">
                {t(
                  "Папка будет создана при необходимости, в неё впишутся правила AGENTS.md. Чаты проекта доступны на каждом устройстве отдельно.",
                )}
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>
                  {t("Готово")}
                </Button>
                <Button type="submit" disabled={busy || !hostId}>
                  {busy ? t("Сохраняю…") : t("Добавить копию")}
                </Button>
              </DialogFooter>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
