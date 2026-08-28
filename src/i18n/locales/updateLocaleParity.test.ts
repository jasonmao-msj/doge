import { describe, expect, it } from "vitest";
import en from "./en/update";
import es from "./es/update";
import fr from "./fr/update";
import hi from "./hi/update";
import ja from "./ja/update";
import ko from "./ko/update";
import ptBR from "./pt-BR/update";
import ru from "./ru/update";
import zh from "./zh/update";
import zhTW from "./zh-TW/update";

const locales = { es, fr, hi, ja, ko, "pt-BR": ptBR, ru, zh, "zh-TW": zhTW };
const expectedKeys = Object.keys(en.update.engineProvisioning).sort();

describe("engine provisioning locale parity", () => {
  it.each(Object.entries(locales))(
    "%s mirrors the English engine provisioning keys",
    (_locale, bundle) => {
      expect(Object.keys(bundle.update.engineProvisioning).sort()).toEqual(
        expectedKeys,
      );
      expect(Object.values(bundle.update.engineProvisioning)).not.toContain("");
    },
  );

  it.each([["en", en], ...Object.entries(locales)])(
    "%s keeps engine provisioning copy phase-only and free of product explanations",
    (_locale, bundle) => {
      const copy = Object.values(bundle.update.engineProvisioning).join(" ");
      expect(copy).not.toContain("{{engine}}");
      expect(copy).not.toMatch(/Doge/i);
    },
  );
});
