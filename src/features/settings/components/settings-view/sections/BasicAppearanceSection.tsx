import type React from "react";
import { useTranslation } from "react-i18next";
import Activity from "lucide-react/dist/esm/icons/activity";
import AppWindow from "lucide-react/dist/esm/icons/app-window";
import Bot from "lucide-react/dist/esm/icons/bot";
import BookOpen from "lucide-react/dist/esm/icons/book-open";
import Construction from "lucide-react/dist/esm/icons/construction";
import Eye from "lucide-react/dist/esm/icons/eye";
import FileEdit from "lucide-react/dist/esm/icons/file-edit";
import Focus from "lucide-react/dist/esm/icons/focus";
import Folder from "lucide-react/dist/esm/icons/folder";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Globe2 from "lucide-react/dist/esm/icons/globe-2";
import Info from "lucide-react/dist/esm/icons/info";
import LayoutList from "lucide-react/dist/esm/icons/layout-list";
import ListChecks from "lucide-react/dist/esm/icons/list-checks";
import MessageSquareQuote from "lucide-react/dist/esm/icons/message-square-quote";
import MessageSquareText from "lucide-react/dist/esm/icons/message-square-text";
import Monitor from "lucide-react/dist/esm/icons/monitor";
import Moon from "lucide-react/dist/esm/icons/moon";
import NotebookPen from "lucide-react/dist/esm/icons/notebook-pen";
import Palette from "lucide-react/dist/esm/icons/palette";
import PanelBottom from "lucide-react/dist/esm/icons/panel-bottom";
import PanelRightOpen from "lucide-react/dist/esm/icons/panel-right-open";
import PanelTop from "lucide-react/dist/esm/icons/panel-top";
import Play from "lucide-react/dist/esm/icons/play";
import RotateCcw from "lucide-react/dist/esm/icons/rotate-ccw";
import Search from "lucide-react/dist/esm/icons/search";
import Sun from "lucide-react/dist/esm/icons/sun";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import type { LucideIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_OPEN_APP_ID,
  DEFAULT_OPEN_APP_TARGETS,
} from "@/features/app/constants";
import {
  GENERIC_APP_ICON,
  getKnownOpenAppIcon,
} from "@/features/app/utils/openAppIcons";
import { useClientUiVisibility } from "@/features/client-ui-visibility/hooks/useClientUiVisibility";
import {
  CLIENT_UI_PANEL_REGISTRY,
  getClientUiControlDefinition,
  type ClientUiVisibilityIconKey,
} from "@/features/client-ui-visibility/utils/clientUiVisibility";
import type { AppSettings, ThemePresetId } from "../../../../../types";
import {
  CODE_FONT_SIZE_DEFAULT,
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  listCodeFontSizeSelectOptions,
} from "../../../../../utils/fonts";
import {
  formatUiScalePercentLabel,
  listUiScaleSelectOptions,
  UI_SCALE_DEFAULT,
} from "../../../../../utils/uiScale";
import { LanguageSelector } from "../../LanguageSelector";
import { SyntaxAndDiffPreview } from "./SyntaxAndDiffPreview";

type BasicAppearanceSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  windowTransparencyEnabled: boolean;
  onToggleWindowTransparency: (enabled: boolean) => void;
  windowOpacity: number;
  onWindowOpacityChange: (next: number) => void;
  activeThemePresetId: ThemePresetId;
  resolvedAppearanceTheme: "light" | "dark";
  themePresetOptions: ReadonlyArray<{ id: ThemePresetId; label: string }>;
  onThemePresetChange: (presetId: ThemePresetId) => Promise<void>;
  uiScaleDraft: number;
  handleCommitUiScale: (next: number) => void;
  handleResetUiScale: () => void;
  scaleShortcutTitle: string;
  scaleShortcutText: string;
  userMsgPresets: ReadonlyArray<{ color: string; label: string }>;
  isUserMsgPresetActive: (presetColor: string) => boolean;
  handleUserMsgPresetClick: (presetColor: string) => void;
  normalizedUserMsgColor: string | null;
  defaultUserMsgColor: string;
  handleUserMsgColorPickerChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  userMsgHexDraft: string;
  handleUserMsgHexInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleResetUserMsgColor: () => void;
  uiFontDraft: string;
  handleUiFontSelectChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  uiFontSelectOptions: string[];
  defaultUiPrimaryFont: string;
  setUiFontDraft: (next: string) => void;
  codeFontDraft: string;
  codeFontSelectOptions: string[];
  handleCodeFontSelectChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  defaultCodePrimaryFont: string;
  setCodeFontDraft: (next: string) => void;
  codeFontSizeDraft: number;
  setCodeFontSizeDraft: (next: number) => void;
  handleCommitCodeFontSize: (nextSize: number) => Promise<void>;
};

const CLIENT_UI_VISIBILITY_ICON_COMPONENTS: Record<ClientUiVisibilityIconKey, LucideIcon> = {
  activity: Activity,
  appWindow: AppWindow,
  bot: Bot,
  bookOpen: BookOpen,
  construction: Construction,
  fileEdit: FileEdit,
  focus: Focus,
  folder: Folder,
  gitBranch: GitBranch,
  globe: Globe2,
  info: Info,
  layoutList: LayoutList,
  listChecks: ListChecks,
  messageSquareQuote: MessageSquareQuote,
  messageSquareText: MessageSquareText,
  panelBottom: PanelBottom,
  panelRightOpen: PanelRightOpen,
  panelTop: PanelTop,
  play: Play,
  search: Search,
  terminal: TerminalSquare,
  notebookPen: NotebookPen,
};

function resolveSelectedOpenAppIconSrc(appSettings: AppSettings) {
  const availableTargets =
    appSettings.openAppTargets.length > 0
      ? appSettings.openAppTargets
      : DEFAULT_OPEN_APP_TARGETS;
  const resolvedOpenAppId =
    availableTargets.find((target) => target.id === appSettings.selectedOpenAppId)?.id ??
    availableTargets[0]?.id ??
    DEFAULT_OPEN_APP_ID;
  return getKnownOpenAppIcon(resolvedOpenAppId) ?? GENERIC_APP_ICON;
}

function ClientUiVisibilityIcon({
  iconKey,
  openAppIconSrc,
}: {
  iconKey: ClientUiVisibilityIconKey;
  openAppIconSrc: string;
}) {
  if (iconKey === "appWindow") {
    return (
      <span className="settings-client-ui-visibility-row-icon" aria-hidden>
        <img src={openAppIconSrc} alt="" />
      </span>
    );
  }
  const Icon = CLIENT_UI_VISIBILITY_ICON_COMPONENTS[iconKey];
  return (
    <span className="settings-client-ui-visibility-row-icon" aria-hidden>
      <Icon size={15} strokeWidth={2.15} />
    </span>
  );
}

export function BasicAppearanceSection({
  appSettings,
  onUpdateAppSettings,
  windowTransparencyEnabled,
  onToggleWindowTransparency,
  windowOpacity,
  onWindowOpacityChange,
  activeThemePresetId,
  resolvedAppearanceTheme,
  themePresetOptions,
  onThemePresetChange,
  uiScaleDraft,
  handleCommitUiScale,
  handleResetUiScale,
  scaleShortcutTitle,
  scaleShortcutText,
  userMsgPresets,
  isUserMsgPresetActive,
  handleUserMsgPresetClick,
  normalizedUserMsgColor,
  defaultUserMsgColor,
  handleUserMsgColorPickerChange,
  userMsgHexDraft,
  handleUserMsgHexInputChange,
  handleResetUserMsgColor,
  uiFontDraft,
  handleUiFontSelectChange,
  uiFontSelectOptions,
  defaultUiPrimaryFont,
  setUiFontDraft,
  codeFontDraft,
  codeFontSelectOptions,
  handleCodeFontSelectChange,
  defaultCodePrimaryFont,
  setCodeFontDraft,
  codeFontSizeDraft,
  setCodeFontSizeDraft,
  handleCommitCodeFontSize,
}: BasicAppearanceSectionProps) {
  const { t } = useTranslation();
  const clientUiVisibility = useClientUiVisibility();
  const selectedOpenAppIconSrc = resolveSelectedOpenAppIconSrc(appSettings);
  const resolvedAppearanceLabel = t(
    resolvedAppearanceTheme === "light" ? "settings.themeLight" : "settings.themeDark",
  );
  const themeModeHint =
    appSettings.theme === "custom"
      ? t("settings.themeModeHintCustom", { appearance: resolvedAppearanceLabel })
      : appSettings.theme === "system"
        ? t("settings.themeModeHintSystem", { appearance: resolvedAppearanceLabel })
        : t("settings.themeModeHintFixed", { appearance: resolvedAppearanceLabel });

  return (
    <div className="settings-basic-appearance settings-basic-surface">
      <div className="settings-basic-group-card settings-basic-group-card--list settings-pref-card">
        <div className="settings-pref-row settings-pref-row--theme">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">{t("settings.theme")}</div>
            <div className="settings-pref-desc">{themeModeHint}</div>
          </div>
          <div
            className="settings-pref-control settings-pref-segmented"
            role="radiogroup"
            aria-label={t("settings.theme")}
          >
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.theme === "system"}
              className={`settings-pref-segment ${
                appSettings.theme === "system" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  theme: "system",
                })
              }
            >
              <Monitor size={14} aria-hidden />
              <span>{t("settings.themeSystem")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.theme === "light"}
              className={`settings-pref-segment ${
                appSettings.theme === "light" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  theme: "light",
                })
              }
            >
              <Sun size={14} aria-hidden />
              <span>{t("settings.themeLight")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.theme === "dark"}
              className={`settings-pref-segment ${
                appSettings.theme === "dark" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  theme: "dark",
                })
              }
            >
              <Moon size={14} aria-hidden />
              <span>{t("settings.themeDark")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.theme === "custom"}
              className={`settings-pref-segment ${
                appSettings.theme === "custom" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  theme: "custom",
                  customThemePresetId: activeThemePresetId,
                })
              }
            >
              <Palette size={14} aria-hidden />
              <span>{t("settings.themeCustom")}</span>
            </button>
          </div>
        </div>

        {appSettings.theme === "custom" ? (
          <div className="settings-pref-row">
            <div className="settings-pref-meta">
              <div className="settings-pref-title">{t("settings.themePreset")}</div>
              <div className="settings-pref-desc">
                {t("settings.themePresetDescription", {
                  appearance: resolvedAppearanceLabel,
                })}
              </div>
            </div>
            <div className="settings-pref-control">
              <div className="settings-pref-select-wrap">
                <select
                  className="settings-pref-select"
                  aria-label={t("settings.themePreset")}
                  value={activeThemePresetId}
                  onChange={(event) =>
                    void onThemePresetChange(event.target.value as ThemePresetId)
                  }
                >
                  {themePresetOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ) : null}

        <SyntaxAndDiffPreview appearance={resolvedAppearanceTheme} />

        <div
          className={`settings-pref-row settings-pref-row--stack${
            windowTransparencyEnabled ? " is-expanded" : ""
          }`}
        >
          <div className="settings-pref-row-main">
            <div className="settings-pref-meta">
              <div className="settings-pref-title">
                {t("settings.windowTransparency")}
              </div>
              <div className="settings-pref-desc">
                {t("settings.windowTransparencyDesc")}
              </div>
            </div>
            <div className="settings-pref-control">
              <Switch
                checked={windowTransparencyEnabled}
                aria-label={t("settings.windowTransparency")}
                onCheckedChange={(checked) => onToggleWindowTransparency(checked)}
              />
            </div>
          </div>
          {windowTransparencyEnabled ? (
            <div className="settings-pref-inline-control">
              <input
                type="range"
                min={55}
                max={100}
                step={1}
                className="settings-input settings-input--range"
                aria-label={t("settings.windowOpacity")}
                value={windowOpacity}
                onChange={(event) =>
                  onWindowOpacityChange(Number(event.target.value))
                }
              />
              <span className="settings-pref-value">
                {t("settings.windowOpacityValue", {
                  value: windowOpacity,
                })}
              </span>
            </div>
          ) : null}
        </div>

        <LanguageSelector />

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">{t("settings.canvasWidth")}</div>
            <div className="settings-pref-desc">{t("settings.canvasWidthDesc")}</div>
          </div>
          <div
            className="settings-pref-control settings-pref-segmented settings-pref-segmented--pair"
            role="radiogroup"
            aria-label={t("settings.canvasWidth")}
          >
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.canvasWidthMode !== "wide"}
              className={`settings-pref-segment ${
                appSettings.canvasWidthMode !== "wide" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  canvasWidthMode: "narrow",
                })
              }
            >
              <span>{t("settings.canvasWidthNarrow")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.canvasWidthMode === "wide"}
              className={`settings-pref-segment ${
                appSettings.canvasWidthMode === "wide" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  canvasWidthMode: "wide",
                })
              }
            >
              <span>{t("settings.canvasWidthWide")}</span>
            </button>
          </div>
        </div>

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">{t("settings.layoutMode")}</div>
            <div className="settings-pref-desc">{t("settings.layoutModeDesc")}</div>
          </div>
          <div
            className="settings-pref-control settings-pref-segmented settings-pref-segmented--pair"
            role="radiogroup"
            aria-label={t("settings.layoutMode")}
          >
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.layoutMode !== "swapped"}
              className={`settings-pref-segment ${
                appSettings.layoutMode !== "swapped" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  layoutMode: "default",
                })
              }
            >
              <span>{t("settings.layoutModeDefault")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.layoutMode === "swapped"}
              className={`settings-pref-segment ${
                appSettings.layoutMode === "swapped" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  layoutMode: "swapped",
                })
              }
            >
              <span>{t("settings.layoutModeSwapped")}</span>
            </button>
          </div>
        </div>

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">{t("settings.interfaceScale")}</div>
            <div className="settings-pref-desc" title={scaleShortcutTitle}>
              {scaleShortcutText}
            </div>
          </div>
          <div className="settings-pref-control settings-pref-font-control">
            <div className="settings-pref-select-wrap">
              <select
                className="settings-pref-select"
                aria-label={t("settings.interfaceScaleAriaLabel")}
                data-testid="settings-ui-scale-select"
                value={String(uiScaleDraft)}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  if (!Number.isFinite(parsed)) {
                    return;
                  }
                  handleCommitUiScale(parsed);
                }}
              >
                {listUiScaleSelectOptions(uiScaleDraft).map((scale) => (
                  <option key={scale} value={String(scale)}>
                    {formatUiScalePercentLabel(scale)}
                  </option>
                ))}
              </select>
            </div>
            {Math.abs(uiScaleDraft - UI_SCALE_DEFAULT) > 0.001 ? (
              <button
                type="button"
                className="settings-pref-reset"
                onClick={handleResetUiScale}
                data-testid="settings-ui-scale-reset"
              >
                {t("settings.reset")}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* 界面显示面板已隐藏，仅隐藏 UI，底层可见性逻辑保留 */}
      {false && (
      <div className="settings-basic-group-card settings-basic-group-card--list settings-client-ui-visibility-card">
        <div className="settings-client-ui-visibility-head">
          <div>
            <div className="settings-subsection-title settings-client-ui-visibility-title">
              <Eye className="settings-basic-field-icon" aria-hidden />
              <span>{t("settings.clientUiVisibility.title")}</span>
            </div>
            <div className="settings-subsection-subtitle">
              {t("settings.clientUiVisibility.description")}
            </div>
          </div>
          <button
            type="button"
            className="ghost settings-button-compact settings-client-ui-visibility-reset"
            onClick={clientUiVisibility.resetVisibility}
          >
            <RotateCcw size={14} aria-hidden />
            {t("settings.clientUiVisibility.reset")}
          </button>
        </div>
        {CLIENT_UI_PANEL_REGISTRY.map((panel) => {
          const panelVisible = clientUiVisibility.isPanelVisible(panel.id);
          return (
            <div className="settings-client-ui-visibility-panel" key={panel.id}>
              <div className="settings-toggle-row settings-client-ui-visibility-panel-row">
                <div className="settings-client-ui-visibility-row-copy">
                  <ClientUiVisibilityIcon
                    iconKey={panel.iconKey}
                    openAppIconSrc={selectedOpenAppIconSrc}
                  />
                  <div className="settings-client-ui-visibility-row-text">
                    <div className="settings-toggle-title">{t(panel.labelKey)}</div>
                    <div className="settings-toggle-subtitle">
                      {t(panel.descriptionKey)}
                    </div>
                  </div>
                </div>
                <Switch
                  checked={panelVisible}
                  aria-label={t(panel.labelKey)}
                  onCheckedChange={(checked) =>
                    clientUiVisibility.setPanelVisible(panel.id, checked)
                  }
                />
              </div>
              {panel.controls.length > 0 ? (
                <div className="settings-client-ui-visibility-controls">
                  {panel.controls.map((controlId) => {
                    const control = getClientUiControlDefinition(controlId);
                    return (
                      <div
                        className={`settings-toggle-row settings-client-ui-visibility-control-row${
                          panelVisible ? "" : " is-parent-hidden"
                        }`}
                        key={control.id}
                      >
                        <div className="settings-client-ui-visibility-row-copy">
                          <ClientUiVisibilityIcon
                            iconKey={control.iconKey}
                            openAppIconSrc={selectedOpenAppIconSrc}
                          />
                          <div className="settings-client-ui-visibility-row-text">
                            <div className="settings-toggle-title">
                              {t(control.labelKey)}
                            </div>
                            <div className="settings-toggle-subtitle">
                              {t(control.descriptionKey)}
                              {!panelVisible ? (
                                <span className="settings-client-ui-visibility-parent-hint">
                                  {" "}
                                  {t("settings.clientUiVisibility.parentHiddenHint")}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <Switch
                          checked={clientUiVisibility.isControlPreferenceVisible(control.id)}
                          aria-label={t(control.labelKey)}
                          onCheckedChange={(checked) =>
                            clientUiVisibility.setControlVisible(control.id, checked)
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      )}

      <div className="settings-basic-group-card settings-basic-group-card--list settings-pref-card settings-pref-card--typography">
        <div className="settings-pref-row settings-pref-row--color">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">{t("settings.userMsgColorLabel")}</div>
            <div className="settings-pref-desc">{t("settings.userMsgColorHint")}</div>
          </div>
          <div className="settings-pref-control settings-pref-color">
            <div className="settings-color-swatch-list" role="list">
              {userMsgPresets.map((preset) => (
                <button
                  key={preset.color}
                  type="button"
                  role="listitem"
                  className={`settings-color-dot${isUserMsgPresetActive(preset.color) ? " is-active" : ""}`}
                  onClick={() => handleUserMsgPresetClick(preset.color)}
                  title={preset.label}
                  aria-label={`${t("settings.userMsgColorLabel")} ${preset.color}`}
                  data-testid={`settings-user-msg-color-preset-${preset.color.slice(1)}`}
                >
                  <span style={{ backgroundColor: preset.color }} />
                </button>
              ))}
              <label
                className={`settings-color-dot settings-color-dot--custom${
                  normalizedUserMsgColor &&
                  !userMsgPresets.some((preset) =>
                    isUserMsgPresetActive(preset.color),
                  )
                    ? " is-active"
                    : ""
                }`}
                title={t("settings.userMsgColorCustom")}
              >
                <span
                  style={{
                    backgroundColor: normalizedUserMsgColor || defaultUserMsgColor,
                  }}
                />
                <input
                  type="color"
                  className="settings-color-picker-input"
                  value={normalizedUserMsgColor || defaultUserMsgColor}
                  onChange={handleUserMsgColorPickerChange}
                  aria-label={t("settings.userMsgColorCustom")}
                />
              </label>
            </div>
            <input
              type="text"
              className="settings-pref-hex-input"
              value={userMsgHexDraft}
              onChange={handleUserMsgHexInputChange}
              placeholder="#6e40c9"
              maxLength={7}
              spellCheck={false}
              aria-label={t("settings.userMsgColorLabel")}
              data-testid="settings-user-msg-color-hex-input"
            />
            {normalizedUserMsgColor ? (
              <button
                type="button"
                className="settings-pref-reset"
                onClick={handleResetUserMsgColor}
                data-testid="settings-user-msg-color-reset"
              >
                {t("settings.reset")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <label className="settings-pref-title" htmlFor="ui-font-family">
              {t("settings.uiFontFamily")}
            </label>
            <div className="settings-pref-desc">{t("settings.uiFontFamilyDesc")}</div>
          </div>
          <div className="settings-pref-control settings-pref-font-control">
            <div className="settings-pref-select-wrap settings-pref-select-wrap--grow">
              <select
                id="ui-font-family"
                className="settings-pref-select"
                value={uiFontDraft}
                onChange={handleUiFontSelectChange}
                data-testid="settings-ui-font-select"
              >
                {uiFontSelectOptions.map((fontName) => (
                  <option key={fontName} value={fontName}>
                    {fontName}
                  </option>
                ))}
              </select>
            </div>
            {uiFontDraft !== defaultUiPrimaryFont ? (
              <button
                type="button"
                className="settings-pref-reset"
                onClick={() => {
                  setUiFontDraft(defaultUiPrimaryFont);
                  void onUpdateAppSettings({
                    ...appSettings,
                    uiFontFamily: DEFAULT_UI_FONT_FAMILY,
                  });
                }}
              >
                {t("settings.reset")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <label className="settings-pref-title" htmlFor="code-font-family">
              {t("settings.codeFontFamily")}
            </label>
            <div className="settings-pref-desc">{t("settings.codeFontFamilyDesc")}</div>
          </div>
          <div className="settings-pref-control settings-pref-font-control">
            <div className="settings-pref-select-wrap settings-pref-select-wrap--grow">
              <select
                id="code-font-family"
                className="settings-pref-select"
                value={codeFontDraft}
                onChange={handleCodeFontSelectChange}
                data-testid="settings-code-font-select"
              >
                {codeFontSelectOptions.map((fontName) => (
                  <option key={fontName} value={fontName}>
                    {fontName}
                  </option>
                ))}
              </select>
            </div>
            {codeFontDraft !== defaultCodePrimaryFont ? (
              <button
                type="button"
                className="settings-pref-reset"
                onClick={() => {
                  setCodeFontDraft(defaultCodePrimaryFont);
                  void onUpdateAppSettings({
                    ...appSettings,
                    codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
                  });
                }}
              >
                {t("settings.reset")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <label className="settings-pref-title" htmlFor="code-font-size">
              {t("settings.codeFontSize")}
            </label>
            <div className="settings-pref-desc">{t("settings.codeFontSizeDesc")}</div>
          </div>
          <div className="settings-pref-control settings-pref-font-control">
            <div className="settings-pref-select-wrap">
              <select
                id="code-font-size"
                className="settings-pref-select"
                data-testid="settings-code-font-size-select"
                aria-label={t("settings.codeFontSize")}
                value={String(codeFontSizeDraft)}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  if (!Number.isFinite(nextValue)) {
                    return;
                  }
                  setCodeFontSizeDraft(nextValue);
                  void handleCommitCodeFontSize(nextValue);
                }}
              >
                {listCodeFontSizeSelectOptions(codeFontSizeDraft).map((size) => (
                  <option key={size} value={String(size)}>
                    {size}px
                  </option>
                ))}
              </select>
            </div>
            {codeFontSizeDraft !== CODE_FONT_SIZE_DEFAULT ? (
              <button
                type="button"
                className="settings-pref-reset"
                onClick={() => {
                  setCodeFontSizeDraft(CODE_FONT_SIZE_DEFAULT);
                  void handleCommitCodeFontSize(CODE_FONT_SIZE_DEFAULT);
                }}
              >
                {t("settings.reset")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
