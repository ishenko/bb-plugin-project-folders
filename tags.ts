import { z } from "zod";
import { colorValue } from "./preferences";

/**
 * Chat labels: a shared list of names and colors, and at most one label per
 * chat. Stored on the BB server so every device shows the same labels.
 */
export const tagSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(40),
  color: colorValue,
});
export type Tag = z.infer<typeof tagSchema>;
export type TagAssignments = Record<string, string>;

/** Labels that parse, in order, without duplicate ids. */
export function parseTags(value: unknown): Tag[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Tag[] = [];
  for (const item of value) {
    const parsed = tagSchema.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    out.push(parsed.data);
  }
  return out;
}

/** Keeps only assignments that point at an existing label. */
export function parseAssignments(value: unknown, tags: Tag[]): TagAssignments {
  const out: TagAssignments = {};
  if (!value || typeof value !== "object") return out;
  const ids = new Set(tags.map((t) => t.id));
  for (const [threadId, tagId] of Object.entries(value))
    if (threadId && typeof tagId === "string" && ids.has(tagId))
      out[threadId] = tagId;
  return out;
}
