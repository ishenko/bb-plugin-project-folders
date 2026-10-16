import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { t } from "./i18n";
import type { rpcContract } from "./server";
import type { SummarySettings as Settings } from "./thread-insight";
import { SettingRow, SettingsGroup, Switch } from "./settings-ui";

/** The model that writes the one-line gist in the chat tooltip. */
export function SummarySettings() {
  const rpc = useRpc<typeof rpcContract>();
  const [value, setValue] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    rpc
      .call("summary_settings", null)
      .then(setValue, (e) => setError(String(e)));
  }, [rpc]);
  if (!value) return error ? <p className="text-destructive">{error}</p> : null;
  const save = (patch: Partial<Settings>) => {
    const next = { ...value, ...patch };
    setValue(next);
    rpc.call("summary_settings_save", next).then(
      (saved) => {
        setValue(saved);
        setError("");
      },
      () => setError(t("Проверьте значение: настройка не сохранена.")),
    );
  };
  const text = (
    id: string,
    field: "model" | "origin" | "envCatalogKey",
    placeholder?: string,
  ) => (
    <input
      id={id}
      className="pf-sinput"
      defaultValue={value[field]}
      key={value[field]}
      placeholder={placeholder}
      disabled={!value.enabled}
      spellCheck={false}
      onBlur={(e) => {
        const next = e.target.value.trim();
        if (next !== value[field]) save({ [field]: next });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
  return (
    <SettingsGroup
      title={t("Краткая суть в подсказке чата")}
      hint={t(
        "При наведении на чат быстрая модель пишет одно предложение о его сути. Суть пишется только при наведении, хранится и переписывается, когда в чате появились новые сообщения.",
      )}
    >
      <SettingRow label={t("Писать краткую суть")} htmlFor="pf-summary-on">
        <Switch
          id="pf-summary-on"
          checked={value.enabled}
          label={t("Писать краткую суть")}
          onChange={(enabled) => save({ enabled })}
        />
      </SettingRow>
      <SettingRow
        label={t("Модель")}
        hint={t(
          "Точный ID модели OmniRoute. Подойдёт самая быстрая и дешёвая.",
        )}
        htmlFor="pf-summary-model"
        disabled={!value.enabled}
      >
        {text("pf-summary-model", "model", "glm/glm-5.3-flash")}
      </SettingRow>
      <SettingRow
        label="Reasoning"
        htmlFor="pf-summary-reasoning"
        disabled={!value.enabled}
      >
        <select
          id="pf-summary-reasoning"
          className="pf-sinput"
          value={value.reasoning}
          disabled={!value.enabled}
          onChange={(e) =>
            save({ reasoning: e.target.value as Settings["reasoning"] })
          }
        >
          {(["none", "low", "medium", "high", "default"] as const).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label="OmniRoute"
        hint={t("Адрес шлюза без пути и слеша в конце.")}
        htmlFor="pf-summary-origin"
        disabled={!value.enabled}
      >
        {text("pf-summary-origin", "origin")}
      </SettingRow>
      <SettingRow
        label={t("Ключ в Env Catalog")}
        hint={t(
          "Имя переменной с ключом OmniRoute. Пусто — ключ codex-omniroute из связки ключей macOS.",
        )}
        htmlFor="pf-summary-key"
        disabled={!value.enabled}
      >
        {text("pf-summary-key", "envCatalogKey", "OMNIROUTE_API_KEY")}
      </SettingRow>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </SettingsGroup>
  );
}
