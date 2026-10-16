import { execFile } from "node:child_process";
import path from "node:path";

/**
 * Space a folder takes on disk, read on its own machine with `du` (allocated
 * blocks, symlinks not followed). Unreadable subfolders still leave a total;
 * a timeout or a platform without `du` gives null rather than a guess.
 */
export async function folderSize(input: {
  path: string;
}): Promise<{ bytes: number | null }> {
  if (!path.isAbsolute(input.path)) throw new Error("Invalid folder path.");
  if (process.platform === "win32") return { bytes: null };
  return new Promise((resolve) => {
    execFile(
      "du",
      ["-sk", input.path],
      { timeout: 30_000, maxBuffer: 1 << 20 },
      (error, stdout) => {
        if (error && (error as { killed?: boolean }).killed)
          return resolve({ bytes: null });
        const kb = Number.parseInt(
          String(stdout).trim().split(/\s+/)[0] ?? "",
          10,
        );
        resolve({ bytes: Number.isFinite(kb) ? kb * 1024 : null });
      },
    );
  });
}
