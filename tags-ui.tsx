import { useEffect, useState, type CSSProperties } from "react";
import { t } from "./i18n";
import { Icon } from "./components/ui/icon";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { ColorPicker } from "./appearance";
import { SettingsGroup } from "./settings-ui";
import { colorCss, COLOR_TOKENS } from "./preferences";
import { useTags } from "./tags-store";
import type { Tag } from "./tags";

/** The compact colored chip a labelled chat shows after its title. */
export function TagChip({ tag }: { tag: Tag }) {
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

/** A colored dot for menus. */
export function TagDot({ color }: { color: string }) {
  return (
    <span
      className="pf-tag-dot"
      aria-hidden="true"
      style={{ "--pf-c": colorCss(color) } as CSSProperties}
    />
  );
}

function TagRow({
  tag,
  index,
  count,
  used,
}: {
  tag: Tag;
  index: number;
  count: number;
  used: number;
}) {
  const { tags, saveTag, deleteTag, reorderTags } = useTags();
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState("");
  useEffect(() => setName(tag.name), [tag.name]);
  const save = async (next: Partial<Tag>) => {
    const merged = { ...tag, ...next };
    if (!merged.name.trim()) {
      setName(tag.name);
      return;
    }
    if (merged.name === tag.name && merged.color === tag.color) return;
    try {
      setError("");
      await saveTag(merged);
    } catch (e) {
      setError(String(e));
    }
  };
  const move = (delta: number) => {
    const ids = tags.map((x) => x.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id!);
    void reorderTags(ids).catch((e) => setError(String(e)));
  };
  return (
    <li className="pf-tag-row">
      <div className="pf-tag-row-main">
        <TagChip tag={{ ...tag, name: name.trim() || tag.name }} />
        <Input
          className="pf-tag-name"
          aria-label={t("Название метки")}
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void save({ name: name.trim() })}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setName(tag.name);
          }}
        />
        <span className="pf-tag-used">
          {used > 0 ? `${t("Чатов")}: ${used}` : ""}
        </span>
        <button
          type="button"
          className="pf-icon"
          aria-label={t("Выше")}
          disabled={index === 0}
          onClick={() => move(-1)}
        >
          <Icon name="ArrowUp" />
        </button>
        <button
          type="button"
          className="pf-icon"
          aria-label={t("Ниже")}
          disabled={index === count - 1}
          onClick={() => move(1)}
        >
          <Icon name="ArrowDown" />
        </button>
        <button
          type="button"
          className="pf-icon"
          aria-label={t("Удалить метку")}
          onClick={() => {
            if (
              used > 0 &&
              !confirm(
                `${t("Удалить метку")} «${tag.name}»? ${t("Она снимется со всех чатов")}: ${used}.`,
              )
            )
              return;
            void deleteTag(tag.id).catch((e) => setError(String(e)));
          }}
        >
          <Icon name="Trash2" />
        </button>
      </div>
      <ColorPicker
        value={tag.color}
        onChange={(color) => color && void save({ color })}
      />
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </li>
  );
}

/** Settings → Chat labels: names and colors, one label per chat. */
export function TagSettings() {
  const { tags, assignments, saveTag } = useTags();
  const [error, setError] = useState("");
  const usage = new Map<string, number>();
  for (const id of Object.values(assignments))
    usage.set(id, (usage.get(id) ?? 0) + 1);
  const add = async () => {
    try {
      setError("");
      await saveTag({
        name: `${t("Метка")} ${tags.length + 1}`,
        color: COLOR_TOKENS[(tags.length * 5 + 7) % COLOR_TOKENS.length]!,
      });
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <SettingsGroup
      title={t("Метки")}
      hint={t(
        "Чату можно поставить одну метку: меню ⋯ у чата → «Метка». Она видна чипом после названия.",
      )}
      actions={
        <Button size="sm" variant="outline" onClick={() => void add()}>
          <Icon name="Plus" />
          {t("Добавить метку")}
        </Button>
      }
    >
      {tags.length === 0 ? (
        <p className="pf-tag-empty">{t("Меток пока нет.")}</p>
      ) : (
        <ul className="pf-tag-list" role="list">
          {tags.map((tag, i) => (
            <TagRow
              key={tag.id}
              tag={tag}
              index={i}
              count={tags.length}
              used={usage.get(tag.id) ?? 0}
            />
          ))}
        </ul>
      )}
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </SettingsGroup>
  );
}
