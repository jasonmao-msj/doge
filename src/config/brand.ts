import manifest from "../../config/brand.json";

export type BrandManifest = {
  schemaVersion: number;
  name: string;
  developmentName: string;
  tagline: string;
  story: string;
  version: string;
  repository: {
    owner: string;
    name: string;
    url: string;
    issuesUrl: string;
  };
  bundle: {
    productionIdentifier: string;
    developmentIdentifier: string;
  };
  runtime: {
    appHomeDirectory: string;
    mainBinary: string;
    daemonBinary: string;
    cargoPackage: string;
    cargoLibrary: string;
    npmPackage: string;
  };
  visual: {
    mascot: string;
    iconConcept: string;
    masterIcon: string;
    appIconSource: string;
    colors: {
      shibaOrange: string;
      cream: string;
      midnightNavy: string;
      aiTeal: string;
    };
  };
  updater: {
    endpoint: string;
    enabled: boolean;
  };
};

export const brand = manifest satisfies BrandManifest;

export const DOGE_NAME = brand.name;
export const DOGE_TAGLINE = brand.tagline;
export const DOGE_REPOSITORY_URL = brand.repository.url;
export const DOGE_ISSUES_URL = brand.repository.issuesUrl;
export const DOGE_COLORS = brand.visual.colors;
