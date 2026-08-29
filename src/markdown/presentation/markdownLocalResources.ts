import {
  isLinkableFilePath,
  recoverLocalFileLinkPath,
} from "../../utils/remarkFileLinks";

const MARKDOWN_IMAGE_FILE_EXTENSION_REGEX =
  /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|ico|avif)(?:[?#].*)?$/i;

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseImageAttributes(raw: string) {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-\w.:]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(raw)) !== null) {
    const key = match[1]?.toLowerCase();
    if (key) attributes[key] = match[3] ?? match[4] ?? match[5] ?? "";
  }
  return attributes;
}

function toHtmlImageTag(src: string, alt?: string, title?: string) {
  const safeSrc = escapeHtmlAttribute(src.trim());
  if (!safeSrc) return "";
  const safeAlt = escapeHtmlAttribute((alt ?? "image").trim() || "image");
  const titlePart = title?.trim()
    ? ` title="${escapeHtmlAttribute(title.trim())}"`
    : "";
  return `<img src="${safeSrc}" alt="${safeAlt}" loading="lazy"${titlePart} />`;
}

function decodeUrlValueSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function looksLikeResourceReference(value: string) {
  const compact = value.replace(/\s+/g, "");
  return Boolean(compact) && (
    /(https?:\/\/|file:\/\/|\/Users\/|data:image\/)/i.test(compact) ||
    /^[A-Za-z]:[\\/]/.test(compact) ||
    MARKDOWN_IMAGE_FILE_EXTENSION_REGEX.test(compact)
  );
}

export function repairFragmentedResourceToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !looksLikeResourceReference(trimmed)) return trimmed;
  return trimmed
    .replace(/(https?):\s*\/\s*\//gi, "$1://")
    .replace(/file:\s*\/\s*\//gi, "file://")
    .replace(/([A-Za-z0-9])\s+([./\\:_-])/g, "$1$2")
    .replace(/([./\\:_-])\s+([A-Za-z0-9])/g, "$1$2")
    .trim();
}

export function normalizeImageLocalPath(src: string) {
  const decoded = repairFragmentedResourceToken(decodeUrlValueSafe(src.trim()));
  if (!decoded) return null;
  if (/^\/[A-Za-z]:[\\/]/.test(decoded)) return decoded.slice(1);
  if (decoded.startsWith("file://")) {
    const withoutScheme = decoded.slice("file://".length);
    const withoutHost = withoutScheme.startsWith("localhost/")
      ? withoutScheme.slice("localhost/".length)
      : withoutScheme;
    if (/^\/[A-Za-z]:[\\/]/.test(withoutHost)) return withoutHost.slice(1);
    if (/^[A-Za-z]:[\\/]/.test(withoutHost)) return withoutHost;
    return withoutHost.startsWith("/") ? withoutHost : `/${withoutHost}`;
  }
  if (
    decoded.startsWith("/") || decoded.startsWith("./") ||
    decoded.startsWith("../") || decoded.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(decoded) || /^\\\\[^\\]/.test(decoded)
  ) return decoded;
  return null;
}

function normalizeMarkdownLocalImageSyntax(value: string) {
  return value.replace(
    /!\[([^\]]*)\]\((file:\/\/[^\s)]+|[A-Za-z]:[\\/][^\s)]*)(?:\s+"([^"]*)")?\)/g,
    (match, rawAlt: string, rawSrc: string, rawTitle: string) => {
      const localPath = normalizeImageLocalPath(rawSrc);
      let renderSrc = localPath ?? rawSrc;
      if (/^[A-Za-z]:[\\/]/.test(renderSrc)) renderSrc = `/${renderSrc}`;
      return toHtmlImageTag(renderSrc, rawAlt, rawTitle) || match;
    },
  );
}

export function normalizeImageTags(value: string) {
  let changed = false;
  const localImages = normalizeMarkdownLocalImageSyntax(value);
  changed ||= localImages !== value;
  const blockTags = localImages.replace(/<image>\s*([\s\S]*?)\s*<\/image>/gi, (match, body: string) => {
    const next = toHtmlImageTag(body.trim());
    if (!next) return match;
    changed = true;
    return next;
  });
  const selfClosing = blockTags.replace(/<image\b([^>]*)\/?>/gi, (match, rawAttrs: string) => {
    const attrs = parseImageAttributes(rawAttrs ?? "");
    const src = attrs.src?.trim();
    if (!src) return match;
    const next = toHtmlImageTag(src, attrs.alt, attrs.title);
    if (!next) return match;
    changed = true;
    return next;
  });
  return changed ? selfClosing : value;
}

export function resolveLocalFileHref(url: string) {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const decoded = recoverLocalFileLinkPath(decodeUrlValueSafe(trimmed));
  const withoutScheme = decoded.startsWith("file://")
    ? normalizeImageLocalPath(decoded) ?? decoded
    : decoded;
  const normalized = repairFragmentedResourceToken(withoutScheme);
  const pathWithoutFragment = normalized.split("#", 1)[0] ?? normalized;
  if (
    normalized.startsWith("/") || normalized.startsWith("./") ||
    normalized.startsWith("../") || normalized.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(normalized)
  ) {
    if (normalized.startsWith("/")) {
      const body = pathWithoutFragment.slice(1);
      if (!body || (!body.includes("/") && !body.includes("."))) return null;
    }
    return normalized;
  }
  return isLinkableFilePath(normalized) ? normalized : null;
}

export function normalizeFragmentedResourceReferences(value: string) {
  const withTargets = value.replace(/(!?\[[^\]]*]\()([\s\S]*?)(\))/g, (match, prefix: string, target: string, suffix: string) => {
    const repaired = repairFragmentedResourceToken(target);
    return repaired && repaired !== target && looksLikeResourceReference(repaired)
      ? `${prefix}${repaired}${suffix}`
      : match;
  });
  let changed = false;
  const lines = withTargets.split(/\r?\n/).map((line) => {
    if (!looksLikeResourceReference(line)) return line;
    const repaired = repairFragmentedResourceToken(line);
    changed ||= repaired !== line;
    return repaired;
  });
  return changed ? lines.join("\n") : withTargets;
}

export function normalizeMarkdownImageSrc(
  src: string,
  convertLocalFileSrc: (path: string) => string,
) {
  const cleaned = repairFragmentedResourceToken(
    src.trim().replace(/^<(.+)>$/, "$1").replace(/^['"](.+)['"]$/, "$1").trim(),
  );
  if (!cleaned) return "";
  if (/^(?:data:|https?:\/\/|asset:\/\/)/.test(cleaned)) return cleaned;
  const localPath = normalizeImageLocalPath(cleaned);
  if (!localPath && !MARKDOWN_IMAGE_FILE_EXTENSION_REGEX.test(cleaned)) return "";
  try {
    return convertLocalFileSrc(localPath ?? cleaned);
  } catch {
    return "";
  }
}
