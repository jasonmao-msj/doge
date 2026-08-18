import { useTranslation } from "react-i18next";
import {
  accountExperienceCopyV1,
  type AccountExperienceCopyV1,
} from "../locale/accountExperienceCopy";

export type AccountExperienceLocaleV1 = "zh-CN" | "en-US";

export function resolveAccountExperienceLocaleV1(
  language: string | undefined,
): AccountExperienceLocaleV1 {
  return language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function useAccountExperienceCopyV1(): AccountExperienceCopyV1 {
  const { i18n } = useTranslation();
  return resolveAccountExperienceLocaleV1(i18n.resolvedLanguage) === "zh-CN"
    ? accountExperienceCopyV1.zh
    : accountExperienceCopyV1.en;
}

export function useAccountExperienceLocaleV1(): AccountExperienceLocaleV1 {
  const { i18n } = useTranslation();
  return resolveAccountExperienceLocaleV1(i18n.resolvedLanguage);
}
