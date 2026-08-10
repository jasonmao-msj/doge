import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import en from "../../../i18n/locales/en";
import es from "../../../i18n/locales/es";
import fr from "../../../i18n/locales/fr";
import hi from "../../../i18n/locales/hi";
import ja from "../../../i18n/locales/ja";
import ko from "../../../i18n/locales/ko";
import ptBR from "../../../i18n/locales/pt-BR";
import ru from "../../../i18n/locales/ru";
import zh from "../../../i18n/locales/zh";
import zhTW from "../../../i18n/locales/zh-TW";
import canonicalBrand from "../../../../config/brand.json";
import inventory from "../../../../config/brand-surfaces.json";

type LocaleBundle = Record<string, unknown>;
type LocaleCode = (typeof inventory.locales)[number];

const localeBundles: Record<LocaleCode, LocaleBundle> = {
  zh,
  "zh-TW": zhTW,
  en,
  hi,
  es,
  fr,
  ja,
  ru,
  ko,
  "pt-BR": ptBR,
};

function stringAt(bundle: LocaleBundle, path: string): string {
  let value: unknown = bundle;
  for (const segment of path.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`locale key ${path} stopped before ${segment}`);
    }
    value = (value as Record<string, unknown>)[segment];
  }
  if (typeof value !== "string") {
    throw new Error(`locale key ${path} is not a string`);
  }
  return value;
}

function placeholders(value: string): string[] {
  return (value.match(/\{\{[^}]+\}\}/gu) ?? []).sort();
}

describe("user-visible doge brand inventory", () => {
  it("classifies unique surfaces by namespace and locale key", () => {
    expect(inventory.schemaVersion).toBe(1);
    expect(new Set(inventory.surfaces.map(({ id }) => id)).size).toBe(
      inventory.surfaces.length,
    );
    inventory.surfaces.forEach(({ localeKey, namespace, requiredTokens, surface }) => {
      expect(surface.length).toBeGreaterThan(0);
      expect(localeKey.startsWith(`${namespace}.`)).toBe(true);
      expect(Array.isArray(requiredTokens)).toBe(true);
    });
  });

  it("matches all ten locale registrations and lazy loaders", () => {
    const i18nIndex = readFileSync(
      resolve(process.cwd(), "src/i18n/index.ts"),
      "utf8",
    );
    const registered = [...i18nIndex.matchAll(/\{ code: "([^"]+)"/gu)].map(
      (match) => match[1],
    );
    const loaders = [
      ...i18nIndex.matchAll(
        /^\s*(?:"([^"]+)"|([A-Za-z][A-Za-z-]*)):\s*\(\)\s*=>\s*import\("\.\/locales\/([^"]+)"\),$/gmu,
      ),
    ].map((match) => ({ code: match[1] ?? match[2], path: match[3] }));

    expect(registered).toEqual(inventory.locales);
    expect(Object.keys(localeBundles)).toEqual(inventory.locales);
    expect(loaders.map(({ code }) => code).sort()).toEqual(
      [...inventory.locales].sort(),
    );
    loaders.forEach(({ code, path }) => expect(path).toBe(code));
  });

  it("uses the canonical doge tagline and AI Shiba story in the source locale", () => {
    expect(stringAt(localeBundles.zh, "about.tagline")).toBe(canonicalBrand.tagline);
    const story = stringAt(localeBundles.zh, "about.story");
    expect(story).toContain("AI 小柴犬");
    expect(story).toContain("文件");
    expect(story).toContain("任务");
    expect(story).toContain("灵感");
  });

  it.each(inventory.locales)(
    "%s exposes every inventoried brand key with English placeholder parity",
    (locale) => {
      const bundle = localeBundles[locale];
      inventory.surfaces.forEach(({ localeKey, requiredTokens }) => {
        const localized = stringAt(bundle, localeKey);
        const english = stringAt(localeBundles.en, localeKey);
        expect(localized.length, `${locale}:${localeKey}`).toBeGreaterThan(0);
        expect(placeholders(localized), `${locale}:${localeKey}`).toEqual(
          placeholders(english),
        );
        requiredTokens.forEach((token) => {
          expect(localized, `${locale}:${localeKey}`).toContain(token);
        });
      });
    },
  );

  it.each(inventory.locales)("%s keeps legacy product names out of locale copy", (locale) => {
    expect(JSON.stringify(localeBundles[locale])).not.toMatch(
      /(?:desktop-cc-gui|cc[\s_-]?gui|CodeMoss|MossX|mossx|codemoss)/iu,
    );
  });

  it.each(inventory.locales)("%s keeps upstream-owned support channels out of locale copy", (locale) => {
    expect(JSON.stringify(localeBundles[locale])).not.toMatch(
      /(?:WeChat|公众号|微信群)/iu,
    );
  });
});
