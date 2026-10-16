import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { folderSize } from "./folder-size";

describe("folderSize", () => {
  it("reports the space a folder takes on disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pf-size-"));
    try {
      await writeFile(path.join(dir, "a.bin"), Buffer.alloc(64 * 1024, 1));
      const { bytes } = await folderSize({ path: dir });
      expect(bytes).toBeGreaterThanOrEqual(64 * 1024);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("refuses a relative path", async () => {
    await expect(folderSize({ path: "relative/dir" })).rejects.toThrow();
  });
  it("gives null for a folder that does not exist", async () => {
    const { bytes } = await folderSize({
      path: path.join(tmpdir(), "pf-size-missing-" + Date.now()),
    });
    expect(bytes).toBeNull();
  });
});
