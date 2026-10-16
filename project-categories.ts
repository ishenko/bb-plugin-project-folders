import { z } from "zod";
import { colorValue } from "./preferences";

export const DEFAULT_CATEGORY_COLOR = "gray";

export const categoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\x00-\x1f\x7f]+$/);
export const projectCategorySchema = z.object({
  id: z.string().min(1).max(64),
  name: categoryNameSchema,
  color: colorValue.optional(),
});
export type ProjectCategory = z.infer<typeof projectCategorySchema>;

/** Unknown assignments fall back to the unassigned list, never hide a project. */
export function groupProjects<T extends { id: string }>(
  projects: readonly T[],
  categories: readonly ProjectCategory[],
  assignments: Readonly<Record<string, string>>,
) {
  const groups = categories.map((category) => ({
    category,
    projects: [] as T[],
  }));
  const byId = new Map(groups.map((group) => [group.category.id, group]));
  const unassigned: T[] = [];
  for (const project of projects) {
    const group = byId.get(assignments[project.id]);
    if (group) group.projects.push(project);
    else unassigned.push(project);
  }
  return { groups, unassigned };
}
