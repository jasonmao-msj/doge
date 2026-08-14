import { useTranslation } from "react-i18next";
import {
  accountExperienceCopyV1,
  type AccountExperienceCopyV1,
} from "../locale/accountExperienceCopy";

export function useAccountExperienceCopyV1(): AccountExperienceCopyV1 {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage?.toLowerCase().startsWith("zh")
    ? accountExperienceCopyV1.zh
    : accountExperienceCopyV1.en;
}
