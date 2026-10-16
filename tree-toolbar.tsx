import * as appSdk from "@get-bb/plugin-sdk/app";
import { experimental_useSidebarThreadActions } from "@get-bb/plugin-sdk/app";
import { Icon } from "./components/ui/icon";
import { t } from "./i18n";

const SEARCH_ITEM = "__bb__/search-threads";
const mac = () => /Mac|iPhone|iPad/.test(navigator.platform);

type NavigationHook = () => {
  actions: { activate(id: string, options: { openInSplit: boolean }): void };
};
// Newer BB exposes its navigation actions; older ones only the ⌘K shortcut.
const useNavigation = (appSdk as Record<string, unknown>)[
  "experimental_useSidebarNavigation"
] as NavigationHook | undefined;
const useSearch = useNavigation
  ? () => {
      const navigation = useNavigation();
      return () =>
        navigation.actions.activate(SEARCH_ITEM, { openInSplit: false });
    }
  : () => () => {
      // BB's own thread search binding (thread.search, Mod+K).
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          code: "KeyK",
          metaKey: mac(),
          ctrlKey: !mac(),
          bubbles: true,
          cancelable: true,
        }),
      );
    };

/** A framed «New chat» button with thread search pinned to its right. */
export function TreeToolbar({ onNavigate }: { onNavigate: () => void }) {
  const actions = experimental_useSidebarThreadActions();
  const search = useSearch();
  const mod = mac() ? "⌘" : "Ctrl+";
  return (
    <div className="pf-toolbar">
      <button
        type="button"
        className="pf-new-chat"
        onClick={() => {
          actions.openNewThread({ focusPrompt: true });
          onNavigate();
        }}
      >
        <Icon name="MessageCirclePlus" />
        <span>{t("Новый чат")}</span>
        <kbd aria-hidden>{mod}N</kbd>
      </button>
      <button
        type="button"
        className="pf-icon pf-toolbar-search"
        aria-label={t("Поиск чатов")}
        title={`${t("Поиск чатов")} (${mod}K)`}
        onClick={search}
      >
        <Icon name="Search" />
      </button>
    </div>
  );
}
