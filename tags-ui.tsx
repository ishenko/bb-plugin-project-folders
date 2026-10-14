import { useEffect, useRef, useState, type CSSProperties } from "react";
import { direction, t } from "./i18n";
import { Icon } from "./components/ui/icon";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { ColorPicker } from "./appearance";
import { SettingsGroup } from "./settings-ui";
import { colorCss, COLOR_TOKENS } from "./preferences";
import { useTags } from "./tags-store";
import type { Tag } from "./tags";

/** The compact colored chip a labelled chat shows after its title. */
export function TagChip({ tag }: { tag: Pick<Tag, "name" | "color"> }) {
  return (
    <span
      className="pf-tag-chip"
      title={tag.name}
      style={{ "--pf-c": colorCss(tag.color) } as CSSProperties}
    >
      {tag.name}
    </span>
  );
}

/** A colored dot for menus and lists. */
export function TagDot({ color }: { color: string }) {
  return (
    <span
      className="pf-tag-dot"
      aria-hidden="true"
      style={{ "--pf-c": colorCss(color) } as CSSProperties}
    />
  );
}

/** Create or edit one label: name, color and a live preview of the chip. */
function TagEditor({
  tag,
  used,
  onClose,
}: {
  /** Absent for a new label. */
  tag?: Tag;
  used: number;
  onClose: () => void;
}) {
  const { tags, saveTag, deleteTag } = useTags();
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(
    tag?.color ?? COLOR_TOKENS[(tags.length * 5 + 7) % COLOR_TOKENS.length]!,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!tag) inputRef.current?.focus();
  }, [tag]);
  const clean = name.trim();
  const save = async () => {
    if (!clean || busy) return;
    setBusy(true);
    setError("");
    try {
      await saveTag({ id: tag?.id, name: clean, color });
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!tag || busy) return;
    if (used > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      await deleteTag(tag.id);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="pf-dialog pf-tag-editor" dir={direction()}>
        <DialogHeader>
          <DialogTitle>{tag ? t("Изменить метку") : t("Новая метка")}</DialogTitle>
          <DialogDescription className="pf-tag-editor-preview">
            <TagChip tag={{ name: clean || t("Метка"), color }} />
          </DialogDescription>
        </DialogHeader>
        <form
          className="pf-tag-editor-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="pf-tag-field">
            <span>{t("Название метки")}</span>
            <Input
              ref={inputRef}
              value={name}
              maxLength={40}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="pf-tag-field">
            <span>{t("Цвет")}</span>
            <ColorPicker
              value={color}
              onChange={(c) => c && setColor(c)}
            />
          </div>
        </form>
        {confirming && (
          <p className="pf-tag-warning" role="alert">
            {t("Она снимется со всех чатов")}: {used}.
          </p>
        )}
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        <DialogFooter className="pf-tag-editor-footer">
          {tag && (
            <Button
              variant={confirming ? "destructive" : "ghost"}
              className={confirming ? "" : "pf-tag-delete"}
              disabled={busy}
              onClick={() => void remove()}
            >
              <Icon name="Trash2" />
              {confirming ? t("Да, удалить") : t("Удалить метку")}
            </Button>
          )}
          <span className="pf-tag-footer-gap" />
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("Отмена")}
          </Button>
          <Button disabled={busy || !clean} onClick={() => void save()}>
            {t("Сохранить")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Settings → Chat labels: a compact list; a label opens in its own editor. */
export function TagSettings() {
  const { tags, assignments, reorderTags, deleteTag } = useTags();
  const [editing, setEditing] = useState<Tag | "new" | null>(null);
  const [error, setError] = useState("");
  const usage = new Map<string, number>();
  for (const id of Object.values(assignments))
    usage.set(id, (usage.get(id) ?? 0) + 1);
  const move = (index: number, delta: number) => {
    const ids = tags.map((x) => x.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id!);
    void reorderTags(ids).catch((e) => setError(String(e)));
  };
  return (
    <SettingsGroup
      title={t("Метки")}
      hint={t(
        "Чату можно поставить одну метку: меню ⋯ у чата → «Метка». Она видна чипом после названия.",
      )}
      actions={
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Icon name="Plus" />
          {t("Добавить метку")}
        </Button>
      }
    >
      {tags.length === 0 ? (
        <p className="pf-tag-empty">{t("Меток пока нет.")}</p>
      ) : (
        <ul className="pf-tag-list" role="list">
          {tags.map((tag, i) => {
            const used = usage.get(tag.id) ?? 0;
            return (
              <li key={tag.id} className="pf-tag-item">
                <button
                  type="button"
                  className="pf-tag-item-main"
                  onClick={() => setEditing(tag)}
                >
                  <TagChip tag={tag} />
                  <span className="pf-tag-used">
                    {used > 0 ? `${t("Чатов")}: ${used}` : ""}
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="pf-icon"
                      aria-label={`${t("Действия")}: ${tag.name}`}
                    >
                      <Icon name="MoreHorizontal" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(tag)}>
                      <Icon name="Edit" />
                      {t("Изменить")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={i === 0}
                      onSelect={() => move(i, -1)}
                    >
                      <Icon name="ArrowUp" />
                      {t("Выше")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={i === tags.length - 1}
                      onSelect={() => move(i, 1)}
                    >
                      <Icon name="ArrowDown" />
                      {t("Ниже")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => {
                        if (used > 0) setEditing(tag);
                        else
                          void deleteTag(tag.id).catch((e) =>
                            setError(String(e)),
                          );
                      }}
                    >
                      <Icon name="Trash2" />
                      {t("Удалить метку")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
      {editing && (
        <TagEditor
          tag={editing === "new" ? undefined : editing}
          used={editing === "new" ? 0 : (usage.get(editing.id) ?? 0)}
          onClose={() => setEditing(null)}
        />
      )}
    </SettingsGroup>
  );
}

/**
 * Picking a chat's label in its own sheet: on phones a submenu would spill
 * every label into the chat menu.
 */
export function TagPicker({
  threadId,
  title,
  onManage,
  onClose,
}: {
  threadId: string;
  title: string;
  onManage: () => void;
  onClose: () => void;
}) {
  const { tags, tagOf, setThreadTag } = useTags();
  const [error, setError] = useState("");
  const current = tagOf(threadId)?.id ?? null;
  const pick = (id: string | null) => {
    if (id === current) return onClose();
    setThreadTag(threadId, id).then(onClose, (e) => setError(String(e)));
  };
  const option = (id: string | null, body: React.ReactNode) => (
    <button
      key={id ?? ""}
      type="button"
      role="radio"
      aria-checked={current === id}
      className={"pf-tag-option" + (current === id ? " pf-selected" : "")}
      onClick={() => pick(id)}
    >
      {body}
      {current === id && <Icon name="Check" className="pf-tag-option-check" />}
    </button>
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="pf-dialog pf-tag-picker" dir={direction()}>
        <DialogHeader>
          <DialogTitle>{t("Метка")}</DialogTitle>
          <DialogDescription className="pf-tag-picker-chat">
            {title}
          </DialogDescription>
        </DialogHeader>
        <div className="pf-tag-options" role="radiogroup">
          {option(
            null,
            <span className="pf-tag-option-none">{t("Без метки")}</span>,
          )}
          {tags.map((tag) => option(tag.id, <TagChip tag={tag} />))}
        </div>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        <Button variant="outline" onClick={onManage}>
          <Icon name="Settings" />
          {tags.length > 0 ? t("Настроить метки…") : t("Создать метку…")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
