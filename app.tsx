import { ThreadSectionLabel } from "./thread-section-label";
import { PluginSettings } from "./plugin-settings";
import { ComposerProjectChip } from "./composer-chip";
import {
  ComposerSectionBanner,
  SECTION_ENVIRONMENT_ID,
  SectionComposerAction,
  SectionEnvironmentInputs,
} from "./section-environment";
import { t, useLanguage, direction } from "./i18n";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ArchiveList, Panel } from "./panel";
import { Tree } from "./tree";
import "./style.css";
function SettingsSection() {
  useLanguage();
  return (
    <div className="pf" dir={direction()} data-bb-ru-skip="">
      <PluginSettings archive={<ArchiveList bare />} />
    </div>
  );
}
export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "section-label",
    title: "Section location",
    component: ThreadSectionLabel,
  });
  app.slots.experimental_threadList({
    id: "tree",
    title: t("Проекты и разделы"),
    description: t("Дерево папок и чатов"),
    component: Tree,
  });
  app.slots.navPanel({
    id: "folders",
    path: "folders",
    title: t("Проекты и разделы"),
    icon: "Folder",
    component: Panel,
  });
  app.slots.settingsSection({
    id: "settings",
    component: SettingsSection,
  });
  // The tree inside BB's own New thread screen: its environment picker renders
  // this beside "Project section".
  app.slots.experimental_environmentProviderInputs({
    environmentProviderId: SECTION_ENVIRONMENT_ID,
    component: SectionEnvironmentInputs,
  });
  // BB's own New thread screen names the project and stops there; this says
  // which section folder the chat will actually start in.
  app.composer.customize({
    id: "section-line",
    scopes: ["new-thread"],
    // The section choice lives in BB's project chip. The one-click Section
    // control is only a fallback for when that chip cannot be found, and it
    // renders nothing otherwise — so it is a banner, not an action: an empty
    // action still takes a plugin slot and can leave BB's action overflow
    // menu open on nothing.
    banners: [
      // Renders nothing of its own: it puts the tree into BB's project chip,
      // where the choice of place belongs.
      { id: "project-chip", chrome: "bare", component: ComposerProjectChip },
      {
        id: "section-picker",
        chrome: "bare",
        component: SectionComposerAction,
      },
      { id: "section", chrome: "bare", component: ComposerSectionBanner },
    ],
  });
});
