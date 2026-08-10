import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  DOGE_ISSUES_URL,
  DOGE_NAME,
  DOGE_REPOSITORY_URL,
} from "@/config/brand";

interface CommunitySectionProps {
  appVersion: string | null;
}

export function CommunitySection({ appVersion }: CommunitySectionProps) {
  const { t } = useTranslation();

  return (
    <section className="settings-section settings-about-section">
      <div className="settings-about-name">
        {DOGE_NAME}
        {appVersion && (
          <span className="settings-about-version">{appVersion}</span>
        )}
      </div>
      <div className="settings-about-tagline">{t("about.tagline")}</div>
      <p className="settings-about-story">{t("about.story")}</p>
      <div className="settings-about-links">
        <button
          type="button"
          className="ghost"
          onClick={() => void openUrl(DOGE_REPOSITORY_URL)}
        >
          {t("about.github")}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => void openUrl(DOGE_ISSUES_URL)}
        >
          {t("about.reportIssue")}
        </button>
      </div>
    </section>
  );
}
