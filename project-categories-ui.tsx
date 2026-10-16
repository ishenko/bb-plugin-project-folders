import { Fragment, useId, useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { groupProjects, type ProjectCategory } from "./project-categories";
import { t, direction } from "./i18n";
import { Icon } from "./components/ui/icon";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
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

export type CategoryDialogState =
  | { kind: "assign"; project: { id: string; name: string } }
  | { kind: "rename" | "delete"; category: ProjectCategory };

function CategoryGroup({
  category,
  projects,
  closed,
  onToggle,
  onEdit,
}: {
  category: ProjectCategory;
  projects: { id: string; node: ReactNode }[];
  closed: boolean;
  onToggle: () => void;
  onEdit: (state: CategoryDialogState) => void;
}) {
  const contentId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <section className="pf-category">
      <div
        className="pf-category-heading"
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenuOpen(true);
        }}
      >
        <button
          type="button"
          className="pf-category-toggle"
          aria-label={category.name}
          aria-expanded={!closed}
          aria-controls={contentId}
          onClick={onToggle}
        >
          <Icon name={closed ? "ChevronRight" : "ChevronDown"} />
          <span className="pf-category-name">{category.name}</span>
          <span className="pf-category-count" aria-hidden>
            {projects.length}
          </span>
        </button>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="pf-icon"
              aria-label={`${t("Действия категории")}: ${category.name}`}
            >
              <Icon name="MoreHorizontal" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => onEdit({ kind: "rename", category })}
            >
              <Icon name="Pencil" />
              {t("Переименовать")}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onEdit({ kind: "delete", category })}
            >
              <Icon name="Trash2" />
              {t("Удалить категорию")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div id={contentId} hidden={closed} className="pf-category-projects">
        {!closed &&
          projects.map((project) => (
            <Fragment key={project.id}>{project.node}</Fragment>
          ))}
      </div>
    </section>
  );
}

export function ProjectCategoryTree({
  categories,
  assignments,
  projects,
  isClosed,
  onToggle,
  onEdit,
}: {
  categories: ProjectCategory[];
  assignments: Record<string, string>;
  projects: { id: string; node: ReactNode }[];
  isClosed: (id: string) => boolean;
  onToggle: (id: string) => void;
  onEdit: (state: CategoryDialogState) => void;
}) {
  const { groups, unassigned } = groupProjects(
    projects,
    categories,
    assignments,
  );
  return (
    <>
      {groups.map(({ category, projects }) => (
        <CategoryGroup
          key={category.id}
          category={category}
          projects={projects}
          closed={isClosed(category.id)}
          onToggle={() => onToggle(category.id)}
          onEdit={onEdit}
        />
      ))}
      {categories.length > 0 && unassigned.length > 0 && (
        <div className="pf-category-unassigned">{t("Без категории")}</div>
      )}
      {unassigned.map((project) => (
        <Fragment key={project.id}>{project.node}</Fragment>
      ))}
    </>
  );
}

export function ProjectCategoryDialog({
  state,
  categories,
  assignments,
  onClose,
  onSaved,
}: {
  state: CategoryDialogState;
  categories: ProjectCategory[];
  assignments: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(
    "category" in state ? state.category.name : "",
  );
  const [choice, setChoice] = useState(
    state.kind === "assign" &&
      categories.some(
        (category) => category.id === assignments[state.project.id],
      )
      ? assignments[state.project.id]
      : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const deleting = state.kind === "delete";
  const naming = creating || state.kind === "rename";
  const title = deleting
    ? t("Удалить категорию")
    : naming
      ? state.kind === "rename"
        ? t("Переименовать")
        : t("Новая категория")
      : t("Категория");
  const save = async () => {
    if (busy || (naming && !name.trim())) return;
    setBusy(true);
    setError("");
    try {
      if (state.kind === "delete")
        await rpc.call("category_delete", { id: state.category.id });
      else if (naming)
        await rpc.call("category_save", {
          name: name.trim(),
          ...(state.kind === "rename" ? { id: state.category.id } : {}),
          ...(state.kind === "assign" ? { projectId: state.project.id } : {}),
        });
      else if (state.kind === "assign")
        await rpc.call("project_category_set", {
          projectId: state.project.id,
          categoryId: choice || null,
        });
      onSaved();
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
        <form
          className="pf-category-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {"project" in state ? state.project.name : state.category.name}
            </DialogDescription>
          </DialogHeader>
          {deleting ? (
            <p className="text-sm">{t("Проекты не будут удалены.")}</p>
          ) : naming ? (
            <label className="pf-category-field">
              {t("Название категории")}
              <Input
                autoFocus
                value={name}
                maxLength={80}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="pf-category-field">
                {t("Категория")}
                <select
                  value={choice}
                  disabled={busy}
                  onChange={(event) => setChoice(event.target.value)}
                >
                  <option value="">{t("Без категории")}</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setCreating(true)}
              >
                <Icon name="Plus" />
                {t("Новая категория")}
              </Button>
            </>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              {t("Отмена")}
            </Button>
            <Button
              type="submit"
              variant={deleting ? "destructive" : "default"}
              disabled={busy || (naming && !name.trim())}
            >
              {busy
                ? t("Загрузка…")
                : deleting
                  ? t("Да, удалить")
                  : t("Сохранить")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
