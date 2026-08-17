import type { EngineType } from "../../../types";
import { isEngineCapabilityAvailable } from "../engineCapabilityMatrix";

const ENGINE_IMAGE_LABEL: Record<EngineType, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  grok: "Grok",
  kimi: "Kimi",
  opencode: "OpenCode",
};

/**
 * Spec matrix projection for `image.input`.
 * All current engines support image attachments (transport differs per CLI).
 */
export function engineSupportsImageInput(
  engine: EngineType | null | undefined,
): boolean {
  if (!engine) {
    // Unknown engine: do not block; backend will apply its own gate.
    return true;
  }
  return isEngineCapabilityAvailable(engine, "image.input");
}

export function getEngineImageInputLabel(engine: EngineType): string {
  return ENGINE_IMAGE_LABEL[engine] ?? engine;
}

type TranslateFn = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export function formatEngineImageInputUnsupportedMessage(
  engine: EngineType,
  translate?: TranslateFn,
): string {
  const engineLabel = getEngineImageInputLabel(engine);
  const fallback = `${engineLabel} does not support image input in this release`;
  if (!translate) {
    return fallback;
  }
  return translate("messages.imageInputUnsupported", {
    engine: engineLabel,
    defaultValue: fallback,
  });
}

export function sanitizeImageAttachmentPaths(images: string[]): string[] {
  return Array.from(
    new Set(
      images
        .map((imagePath) => imagePath.trim())
        .filter((imagePath) => imagePath.length > 0),
    ),
  );
}
