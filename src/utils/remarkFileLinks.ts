const FILE_LINK_PROTOCOL = "codex-file:";

const SPACED_WINDOWS_FILE_PATH_PATTERN = String.raw`[A-Za-z]:[\\/](?![\\/])[^\r\n\`"'<>|]*?\.[A-Za-z0-9]{1,12}(?:#[A-Za-z0-9:_-]+)?`;
const SPACED_POSIX_FILE_PATH_PATTERN = String.raw`\/(?:Users|Volumes|home|tmp|var|private)\/[^\r\n\`"'<>]*?\.[A-Za-z0-9]{1,12}(?:#[A-Za-z0-9:_-]+)?`;
const WINDOWS_ABSOLUTE_PATH_PATTERN = String.raw`[A-Za-z]:[\\/](?![\\/])[^\s\`"'<>\|]+`;
const FILE_PATH_PATTERN =
  new RegExp(
    String.raw`(${SPACED_WINDOWS_FILE_PATH_PATTERN}|${SPACED_POSIX_FILE_PATH_PATTERN}|${WINDOWS_ABSOLUTE_PATH_PATTERN}|\/[^\s\`"'<>]+|~\/[^\s\`"'<>]+|\.{1,2}\/[^\s\`"'<>]+|[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)`,
    "g",
  );
const FILE_PATH_MATCH = new RegExp(`^${FILE_PATH_PATTERN.source}$`);
const WINDOWS_ABSOLUTE_PATH_MATCH = new RegExp(
  `^(?:${SPACED_WINDOWS_FILE_PATH_PATTERN}|${WINDOWS_ABSOLUTE_PATH_PATTERN})$`,
);
const BARE_SPACED_WINDOWS_FILE_PATH_PATTERN = new RegExp(
  SPACED_WINDOWS_FILE_PATH_PATTERN,
  "g",
);
const BARE_WINDOWS_FILE_PATH_PATTERN = new RegExp(
  String.raw`${SPACED_WINDOWS_FILE_PATH_PATTERN}|${WINDOWS_ABSOLUTE_PATH_PATTERN}`,
  "g",
);

const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}"]);
// CJK ideographs, kana, and full-width punctuation — characters that show up in
// prose but never in real code file paths.
const CJK_PATTERN = /[぀-ヿ㐀-䶿一-鿿＀-￯]/;
const FILE_EXTENSION_PATTERN = /\.[A-Za-z0-9]+$/;
const RELATIVE_ALLOWED_PREFIXES = [
  "src/",
  "app/",
  "lib/",
  "tests/",
  "test/",
  "packages/",
  "apps/",
  "docs/",
  "scripts/",
];

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

function isPathCandidate(
  value: string,
  leadingContext: string,
  previousChar: string,
) {
  if (WINDOWS_ABSOLUTE_PATH_MATCH.test(value)) {
    return true;
  }
  if (!value.includes("/")) {
    return false;
  }
  if (value.startsWith("//")) {
    return false;
  }
  // Prose written with slashes (e.g. "/MCP/权限/models" or "/分支/历史回溯")
  // looks like an absolute path but isn't. A token carrying CJK text is only a
  // real path when its last segment ends in a file extension (e.g.
  // "/Users/张三/a.ts"); otherwise it is prose, not a path.
  if (
    CJK_PATTERN.test(value) &&
    !FILE_EXTENSION_PATTERN.test(value.split("/").pop() ?? "")
  ) {
    return false;
  }
  if (leadingContext.endsWith("://")) {
    return false;
  }
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
    if (value.startsWith("/") && previousChar && /[A-Za-z0-9.]/.test(previousChar)) {
      return false;
    }
    // Reject slash-commands like /aimax:plan, /commit, /help – single-segment
    // paths (no nested "/") that contain ":" or have no file extension are
    // almost certainly chat commands, not file paths.
    if (value.startsWith("/") && !value.slice(1).includes("/")) {
      const segment = value.slice(1);
      if (segment.includes(":") || !segment.includes(".")) {
        return false;
      }
    }
    return true;
  }
  if (value.startsWith("~/")) {
    return true;
  }
  const lastSegment = value.split("/").pop() ?? "";
  if (lastSegment.includes(".")) {
    return true;
  }
  return RELATIVE_ALLOWED_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function splitTrailingPunctuation(value: string) {
  let end = value.length;
  while (end > 0 && TRAILING_PUNCTUATION.has(value[end - 1] ?? "")) {
    end -= 1;
  }
  return {
    path: value.slice(0, end),
    trailing: value.slice(end),
  };
}

function escapeMarkdownLinkText(value: string) {
  return value.replace(/([\\[\]])/g, "\\$1");
}

export function toFileLink(path: string) {
  return `${FILE_LINK_PROTOCOL}${encodeURIComponent(path)}`;
}

function linkifyText(value: string) {
  FILE_PATH_PATTERN.lastIndex = 0;
  const nodes: MarkdownNode[] = [];
  let lastIndex = 0;
  let hasLink = false;

  for (const match of value.matchAll(FILE_PATH_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const raw = match[0];
    if (matchIndex > lastIndex) {
      nodes.push({ type: "text", value: value.slice(lastIndex, matchIndex) });
    }

    const leadingContext = value.slice(Math.max(0, matchIndex - 3), matchIndex);
    const previousChar = matchIndex > 0 ? (value[matchIndex - 1] ?? "") : "";
    const { path, trailing } = splitTrailingPunctuation(raw);
    if (path && isPathCandidate(path, leadingContext, previousChar)) {
      nodes.push({
        type: "link",
        url: toFileLink(path),
        children: [{ type: "text", value: path }],
      });
      if (trailing) {
        nodes.push({ type: "text", value: trailing });
      }
      hasLink = true;
    } else {
      nodes.push({ type: "text", value: raw });
    }

    lastIndex = matchIndex + raw.length;
  }

  if (lastIndex < value.length) {
    nodes.push({ type: "text", value: value.slice(lastIndex) });
  }

  return hasLink ? nodes : null;
}

function isSkippableParent(parentType?: string) {
  return parentType === "link" || parentType === "inlineCode" || parentType === "code";
}

function walk(node: MarkdownNode, parentType?: string) {
  if (!node.children) {
    return;
  }

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    if (!child) {
      continue;
    }
    if (
      child.type === "text" &&
      typeof child.value === "string" &&
      !isSkippableParent(parentType)
    ) {
      const nextNodes = linkifyText(child.value);
      if (nextNodes) {
        node.children.splice(index, 1, ...nextNodes);
        index += nextNodes.length - 1;
        continue;
      }
    }
    walk(child, child.type);
  }
}

export function remarkFileLinks() {
  return (tree: MarkdownNode) => {
    walk(tree);
  };
}

export function normalizeBareWindowsFilePathLinks(value: string) {
  BARE_SPACED_WINDOWS_FILE_PATH_PATTERN.lastIndex = 0;
  let changed = false;
  const normalized = value.replace(
    BARE_SPACED_WINDOWS_FILE_PATH_PATTERN,
    (rawPath: string, offset: number, source: string) => {
      if (!rawPath.includes(" ")) {
        return rawPath;
      }
      const previousChar = offset > 0 ? source[offset - 1] : "";
      if (previousChar === "(") {
        return rawPath;
      }
      changed = true;
      return `[${escapeMarkdownLinkText(rawPath)}](${toFileLink(rawPath)})`;
    },
  );
  return changed ? normalized : value;
}

export function normalizeBareWindowsFilePathLinksAround(
  value: string,
  normalizer: (value: string) => string,
) {
  BARE_WINDOWS_FILE_PATH_PATTERN.lastIndex = 0;
  const protectedRegions: Array<{ token: string; markdownLink: string }> = [];
  const protectedValue = value.replace(
    BARE_WINDOWS_FILE_PATH_PATTERN,
    (rawPath: string, offset: number, source: string) => {
      const previousChar = offset > 0 ? source[offset - 1] : "";
      if (previousChar === "(") {
        return rawPath;
      }
      const token = `\u0000DOGEWINDOWSPATH${protectedRegions.length}\u0000`;
      protectedRegions.push({
        token,
        markdownLink: `[${escapeMarkdownLinkText(rawPath)}](${toFileLink(rawPath)})`,
      });
      return token;
    },
  );
  const normalized = normalizer(protectedValue);
  if (protectedRegions.length === 0) {
    return normalized;
  }
  return protectedRegions.reduce(
    (current, region) => current.split(region.token).join(region.markdownLink),
    normalized,
  );
}

export function isLinkableFilePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (!FILE_PATH_MATCH.test(trimmed)) {
    return false;
  }
  return isPathCandidate(trimmed, "", "");
}

export function isFileLinkUrl(url: string) {
  return url.startsWith(FILE_LINK_PROTOCOL);
}

export function decodeFileLink(url: string) {
  return decodeURIComponent(url.slice(FILE_LINK_PROTOCOL.length));
}
