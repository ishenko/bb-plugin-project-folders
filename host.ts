import { editFolder } from "./folder-files";
import { folderSize } from "./folder-size";
import { githubRemotes, githubVisibility } from "./github-remote";
import { sessionInventory } from "./session-inventory";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { moveHostContract } from "./move-contract";
import { inspectMove, moveDirectory, linkDirectory } from "./move-files";
export default experimental_defineHostEntry({
  contract: moveHostContract,
  handlers: {
    folder_edit: editFolder,
    inspect: inspectMove,
    move: moveDirectory,
    link: linkDirectory,
    github_remotes: githubRemotes,
    github_visibility: githubVisibility,
    folder_size: folderSize,
    session_inventory: sessionInventory,
  },
});
