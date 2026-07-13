// 技术名词解释（glossary capability）的纯逻辑层：
// 词库解析、匹配器编译、hast 文本节点高亮。不含 IO 与 React。

export interface GlossaryTermDefinition {
  term: string;
  aliases?: string[];
  explanation: string;
}

export interface GlossaryDocument {
  version: number;
  terms: GlossaryTermDefinition[];
}

export interface GlossaryEntry {
  term: string;
  explanation: string;
  pluginId: string;
  pluginName: string;
}

export interface GlossaryMatcher {
  lookup: Map<string, GlossaryEntry>;
  /** 词条 key 的长度集合，降序（长词优先匹配） */
  lengths: number[];
  /** 词条 key 首字符集合（小写），扫描预筛用 */
  firstChars: Set<string>;
}

const MAX_TERMS_PER_MATCHER = 2000;
const MAX_TERM_LENGTH = 64;

// 宽容解析：结构不合法返回 null，单条词条不合法则跳过该条。
export function parseGlossaryDocument(raw: string): GlossaryDocument | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const doc = parsed as { version?: unknown; terms?: unknown };
  if (doc.version !== 1 || !Array.isArray(doc.terms)) {
    return null;
  }
  const terms: GlossaryTermDefinition[] = [];
  for (const item of doc.terms) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const candidate = item as {
      term?: unknown;
      aliases?: unknown;
      explanation?: unknown;
    };
    if (
      typeof candidate.term !== "string" ||
      !candidate.term.trim() ||
      candidate.term.length > MAX_TERM_LENGTH ||
      typeof candidate.explanation !== "string" ||
      !candidate.explanation.trim()
    ) {
      continue;
    }
    const aliases = Array.isArray(candidate.aliases)
      ? candidate.aliases.filter(
          (alias): alias is string =>
            typeof alias === "string" &&
            !!alias.trim() &&
            alias.length <= MAX_TERM_LENGTH,
        )
      : undefined;
    terms.push({
      term: candidate.term.trim(),
      ...(aliases && aliases.length > 0
        ? { aliases: aliases.map((alias) => alias.trim()) }
        : {}),
      explanation: candidate.explanation.trim(),
    });
  }
  return { version: 1, terms };
}

const ASCII_WORD_CHAR = /[A-Za-z0-9]/;

function isAsciiWordChar(ch: string | undefined): boolean {
  return !!ch && ASCII_WORD_CHAR.test(ch);
}

export interface GlossarySource {
  pluginId: string;
  pluginName: string;
  document: GlossaryDocument;
}

// 编译所有已装词库为单个匹配器：小写 key → 词条 的查表 + 词长集合（降序，
// 保证「SQL 注入」优先于「注入」）+ 首字符集合（扫描时一次 Set 查询跳过
// 绝大多数位置）。不用 alternation 正则——千级词条的交替正则单次扫描
// 毫秒级，会拖垮流式渲染；查表扫描与词条数量解耦。
// 词库为空时返回 null（渲染链零开销）。
export function buildGlossaryMatcher(
  sources: GlossarySource[],
): GlossaryMatcher | null {
  const lookup = new Map<string, GlossaryEntry>();
  // 检查前置 + labeled break：命中上限时跳出全部循环，严格封顶 MAX_TERMS_PER_MATCHER
  // （旧写法只 break 内层 alias 循环，外层仍逐词条增长，上限形同虚设）。
  buildLookup: for (const source of sources) {
    for (const definition of source.document.terms) {
      const entry: GlossaryEntry = {
        term: definition.term,
        explanation: definition.explanation,
        pluginId: source.pluginId,
        pluginName: source.pluginName,
      };
      for (const key of [definition.term, ...(definition.aliases ?? [])]) {
        if (lookup.size >= MAX_TERMS_PER_MATCHER) {
          break buildLookup;
        }
        const normalized = key.toLowerCase();
        if (!lookup.has(normalized)) {
          lookup.set(normalized, entry);
        }
      }
    }
  }
  if (lookup.size === 0) {
    return null;
  }
  const lengths = [
    ...new Set([...lookup.keys()].map((key) => key.length)),
  ].sort((a, b) => b - a);
  const firstChars = new Set([...lookup.keys()].map((key) => key[0] ?? ""));
  return { lookup, lengths, firstChars };
}

export interface GlossaryMatch {
  index: number;
  /** 原文中的匹配片段（保留原大小写） */
  text: string;
  /** 归一化（小写）的查表 key */
  key: string;
}

/**
 * 线性扫描文本，返回所有命中词条（长词优先、不重叠）。
 * ASCII 词带词边界语义（"API" 不命中 "APIs"/"OpenAPI"），大小写不敏感。
 */
export function findGlossaryMatches(
  matcher: GlossaryMatcher,
  text: string,
): GlossaryMatch[] {
  const lower = text.toLowerCase();
  const matches: GlossaryMatch[] = [];
  let index = 0;
  while (index < lower.length) {
    if (!matcher.firstChars.has(lower[index] ?? "")) {
      index += 1;
      continue;
    }
    let advanced = false;
    for (const length of matcher.lengths) {
      if (index + length > lower.length) {
        continue;
      }
      const key = lower.slice(index, index + length);
      if (!matcher.lookup.has(key)) {
        continue;
      }
      if (isAsciiWordChar(key[0]) && isAsciiWordChar(lower[index - 1])) {
        continue;
      }
      if (
        isAsciiWordChar(key[length - 1]) &&
        isAsciiWordChar(lower[index + length])
      ) {
        continue;
      }
      matches.push({ index, text: text.slice(index, index + length), key });
      index += length;
      advanced = true;
      break;
    }
    if (!advanced) {
      index += 1;
    }
  }
  return matches;
}

export function lookupGlossaryEntry(
  matcher: GlossaryMatcher | null,
  text: string,
): GlossaryEntry | null {
  if (!matcher) {
    return null;
  }
  return matcher.lookup.get(text.trim().toLowerCase()) ?? null;
}

// ---------------------------------------------------------------------------
// rehype 高亮插件（照 remarkFileLinks 的手写 walk 先例，不引入 unist-util-visit）
// ---------------------------------------------------------------------------

export const GLOSSARY_TERM_TAG = "glossary-term";

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

// 代码/链接/键帽等语境里的名词不标注；KaTeX 输出子树整体跳过。
const SKIP_TAG_NAMES = new Set([
  "code",
  "pre",
  "a",
  "script",
  "style",
  "kbd",
  "samp",
  "var",
  GLOSSARY_TERM_TAG,
]);

function isKatexElement(node: HastNode): boolean {
  const className = node.properties?.className;
  if (typeof className === "string") {
    return className.includes("katex");
  }
  if (Array.isArray(className)) {
    return className.some(
      (item) => typeof item === "string" && item.includes("katex"),
    );
  }
  return false;
}

function highlightTextNode(
  value: string,
  matcher: GlossaryMatcher,
  seenKeys: Set<string>,
): HastNode[] | null {
  let nodes: HastNode[] | null = null;
  let lastIndex = 0;
  for (const match of findGlossaryMatches(matcher, value)) {
    // 每条消息内同一名词只标注首次出现，避免长文里通篇下划线。
    if (seenKeys.has(match.key)) {
      continue;
    }
    seenKeys.add(match.key);
    nodes ??= [];
    if (match.index > lastIndex) {
      nodes.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }
    nodes.push({
      type: "element",
      tagName: GLOSSARY_TERM_TAG,
      properties: {},
      children: [{ type: "text", value: match.text }],
    });
    lastIndex = match.index + match.text.length;
  }
  if (!nodes) {
    return null;
  }
  if (lastIndex < value.length) {
    nodes.push({ type: "text", value: value.slice(lastIndex) });
  }
  return nodes;
}

function walkHast(
  node: HastNode,
  matcher: GlossaryMatcher,
  seenKeys: Set<string>,
): void {
  if (!node.children) {
    return;
  }
  if (node.type === "element") {
    if (SKIP_TAG_NAMES.has(node.tagName ?? "") || isKatexElement(node)) {
      return;
    }
  }
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    if (!child) {
      continue;
    }
    if (child.type === "text" && typeof child.value === "string") {
      const replacement = highlightTextNode(child.value, matcher, seenKeys);
      if (replacement) {
        node.children.splice(index, 1, ...replacement);
        index += replacement.length - 1;
      }
      continue;
    }
    walkHast(child, matcher, seenKeys);
  }
}

/**
 * 生成 rehype 插件：把文本节点里的已知名词包成 glossary-term 元素。
 * 必须放在 rehype-sanitize 之后运行（sanitize 会剥掉未知标签）。
 */
export function createGlossaryRehypePlugin(matcher: GlossaryMatcher) {
  return function rehypeGlossaryTerms() {
    return (tree: unknown) => {
      walkHast(tree as HastNode, matcher, new Set());
    };
  };
}
