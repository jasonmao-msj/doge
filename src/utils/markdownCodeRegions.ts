const CODE_FENCE_LINE_REGEX = /^\s*(```|~~~)/;
const INLINE_CODE_PLACEHOLDER_PREFIX = "\u0000DOGEINLINECODETOKEN";

type InlineCodeInfo = {
  hasInlineCode: boolean;
  hasUnclosedInlineCode: boolean;
};

function isEscapedBacktick(value: string, index: number) {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function scanInlineCodeState(value: string): InlineCodeInfo {
  if (!value.includes("`")) {
    return {
      hasInlineCode: false,
      hasUnclosedInlineCode: false,
    };
  }
  let cursor = 0;
  let openDelimiterLength = 0;
  let hasInlineCode = false;
  while (cursor < value.length) {
    if (value[cursor] !== "`" || isEscapedBacktick(value, cursor)) {
      cursor += 1;
      continue;
    }
    const delimiterStart = cursor;
    while (cursor < value.length && value[cursor] === "`") {
      cursor += 1;
    }
    const delimiterLength = cursor - delimiterStart;
    if (openDelimiterLength === 0) {
      openDelimiterLength = delimiterLength;
      hasInlineCode = true;
      continue;
    }
    if (delimiterLength === openDelimiterLength) {
      openDelimiterLength = 0;
    }
  }
  return {
    hasInlineCode,
    hasUnclosedInlineCode: openDelimiterLength > 0,
  };
}

function normalizeOutsideInlineCode(
  value: string,
  normalizer: (segment: string) => string,
  options?: { reuseIdenticalRegions?: boolean },
) {
  if (!value.includes("`")) {
    return normalizer(value);
  }
  let cursor = 0;
  let protectedStart = -1;
  let openDelimiterLength = 0;
  let lastSafeCursor = 0;
  let tokenIndex = 0;
  let placeholderValue = "";
  const protectedRegions: Array<{ token: string; value: string }> = [];
  const tokenByRegionValue = options?.reuseIdenticalRegions
    ? new Map<string, string>()
    : null;
  const usedTokens = new Set<string>();

  const createPlaceholderToken = (regionValue: string) => {
    if (tokenByRegionValue) {
      const cachedToken = tokenByRegionValue.get(regionValue);
      if (cachedToken) {
        return cachedToken;
      }
    }
    let suffix = 0;
    let token = `${INLINE_CODE_PLACEHOLDER_PREFIX}${tokenIndex}_${suffix}\u0000`;
    while (value.includes(token) || usedTokens.has(token)) {
      suffix += 1;
      token = `${INLINE_CODE_PLACEHOLDER_PREFIX}${tokenIndex}_${suffix}\u0000`;
    }
    usedTokens.add(token);
    tokenByRegionValue?.set(regionValue, token);
    tokenIndex += 1;
    return token;
  };

  while (cursor < value.length) {
    if (value[cursor] !== "`" || isEscapedBacktick(value, cursor)) {
      cursor += 1;
      continue;
    }
    const delimiterStart = cursor;
    while (cursor < value.length && value[cursor] === "`") {
      cursor += 1;
    }
    const delimiterLength = cursor - delimiterStart;
    if (openDelimiterLength === 0) {
      protectedStart = delimiterStart;
      openDelimiterLength = delimiterLength;
      continue;
    }
    if (delimiterLength === openDelimiterLength) {
      const regionValue = value.slice(protectedStart, cursor);
      const token = createPlaceholderToken(regionValue);
      placeholderValue += `${value.slice(lastSafeCursor, protectedStart)}${token}`;
      protectedRegions.push({ token, value: regionValue });
      lastSafeCursor = cursor;
      protectedStart = -1;
      openDelimiterLength = 0;
    }
  }

  if (openDelimiterLength > 0 && protectedStart >= 0) {
    const regionValue = value.slice(protectedStart);
    const token = createPlaceholderToken(regionValue);
    placeholderValue += `${value.slice(lastSafeCursor, protectedStart)}${token}`;
    protectedRegions.push({ token, value: regionValue });
    lastSafeCursor = value.length;
  }
  if (protectedRegions.length === 0) {
    return normalizer(value);
  }
  placeholderValue += value.slice(lastSafeCursor);
  const normalized = normalizer(placeholderValue);
  if (normalized === placeholderValue) {
    return value;
  }

  return protectedRegions.reduce(
    (current, region) => current.split(region.token).join(region.value),
    normalized,
  );
}

export function getMarkdownInlineCodeInfo(value: string): InlineCodeInfo {
  if (!value.includes("`")) {
    return {
      hasInlineCode: false,
      hasUnclosedInlineCode: false,
    };
  }
  const lines = value.split(/\r?\n/);
  let inFence = false;
  let buffer: string[] = [];
  let hasInlineCode = false;
  let hasUnclosedInlineCode = false;

  const flushBuffer = () => {
    if (buffer.length === 0 || inFence) {
      buffer = [];
      return;
    }
    const state = scanInlineCodeState(buffer.join("\n"));
    hasInlineCode ||= state.hasInlineCode;
    hasUnclosedInlineCode ||= state.hasUnclosedInlineCode;
    buffer = [];
  };

  for (const line of lines) {
    if (CODE_FENCE_LINE_REGEX.test(line)) {
      flushBuffer();
      inFence = !inFence;
      continue;
    }
    buffer.push(line);
  }
  flushBuffer();

  return {
    hasInlineCode,
    hasUnclosedInlineCode,
  };
}

export function normalizeOutsideMarkdownCode(
  value: string,
  normalizer: (segment: string) => string,
) {
  return normalizeOutsideMarkdownCodeWithOptions(value, normalizer);
}

export function normalizeOutsideMarkdownCodeStableInlineRegions(
  value: string,
  normalizer: (segment: string) => string,
) {
  return normalizeOutsideMarkdownCodeWithOptions(value, normalizer, {
    reuseIdenticalRegions: true,
  });
}

function normalizeOutsideMarkdownCodeWithOptions(
  value: string,
  normalizer: (segment: string) => string,
  options?: { reuseIdenticalRegions?: boolean },
) {
  if (!value.includes("```") && !value.includes("~~~") && !value.includes("`")) {
    return normalizer(value);
  }
  const lines = value.split(/\r?\n/);
  const segments: string[] = [];
  let inFence = false;
  let buffer: string[] = [];
  let changed = false;

  const flushBuffer = () => {
    if (buffer.length === 0) {
      return;
    }
    const segment = buffer.join("\n");
    if (inFence) {
      segments.push(segment);
    } else {
      const normalized = normalizeOutsideInlineCode(segment, normalizer, options);
      if (normalized !== segment) {
        changed = true;
      }
      segments.push(normalized);
    }
    buffer = [];
  };

  for (const line of lines) {
    if (CODE_FENCE_LINE_REGEX.test(line)) {
      flushBuffer();
      segments.push(line);
      inFence = !inFence;
      continue;
    }
    buffer.push(line);
  }
  flushBuffer();

  const normalized = segments.join("\n");
  return changed ? normalized : value;
}
