import { describe, expect, it } from "vitest";
import {
  GLOSSARY_TERM_TAG,
  buildGlossaryMatcher,
  createGlossaryRehypePlugin,
  findGlossaryMatches,
  lookupGlossaryEntry,
  parseGlossaryDocument,
  type GlossarySource,
} from "./glossary";

function buildSource(
  terms: Array<{ term: string; aliases?: string[]; explanation?: string }>,
): GlossarySource {
  return {
    pluginId: "tech-glossary",
    pluginName: "技术名词解释",
    document: {
      version: 1,
      terms: terms.map((item) => ({
        term: item.term,
        ...(item.aliases ? { aliases: item.aliases } : {}),
        explanation: item.explanation ?? `${item.term} 的解释`,
      })),
    },
  };
}

describe("parseGlossaryDocument", () => {
  it("parses valid documents and trims fields", () => {
    const doc = parseGlossaryDocument(
      JSON.stringify({
        version: 1,
        terms: [{ term: " API ", aliases: [" 接口 "], explanation: " 解释 " }],
      }),
    );
    expect(doc?.terms).toEqual([
      { term: "API", aliases: ["接口"], explanation: "解释" },
    ]);
  });

  it("rejects invalid roots and skips invalid entries", () => {
    expect(parseGlossaryDocument("not json")).toBeNull();
    expect(parseGlossaryDocument('{"version":2,"terms":[]}')).toBeNull();
    expect(parseGlossaryDocument('{"version":1}')).toBeNull();
    const doc = parseGlossaryDocument(
      JSON.stringify({
        version: 1,
        terms: [
          { term: "", explanation: "x" },
          { term: "ok", explanation: "" },
          { term: "API", explanation: "好解释" },
          "garbage",
        ],
      }),
    );
    expect(doc?.terms).toHaveLength(1);
    expect(doc?.terms[0]?.term).toBe("API");
  });
});

describe("buildGlossaryMatcher", () => {
  it("returns null when no terms exist", () => {
    expect(buildGlossaryMatcher([])).toBeNull();
    expect(buildGlossaryMatcher([buildSource([])])).toBeNull();
  });

  it("matches terms case-insensitively with ascii word boundaries", () => {
    const matcher = buildGlossaryMatcher([buildSource([{ term: "API" }])]);
    expect(matcher).not.toBeNull();
    expect(findGlossaryMatches(matcher!, "调用 api 接口")[0]?.text).toBe("api");
    expect(findGlossaryMatches(matcher!, "小API了")[0]?.text).toBe("API");
    // 词边界：不命中 APIs / OpenAPI
    expect(findGlossaryMatches(matcher!, "many APIs")).toHaveLength(0);
    expect(findGlossaryMatches(matcher!, "OpenAPI")).toHaveLength(0);
  });

  it("resolves aliases to the canonical entry", () => {
    const matcher = buildGlossaryMatcher([
      buildSource([
        { term: "API", aliases: ["接口"], explanation: "服务窗口" },
      ]),
    ]);
    const entry = lookupGlossaryEntry(matcher, "接口");
    expect(entry?.term).toBe("API");
    expect(entry?.explanation).toBe("服务窗口");
    expect(lookupGlossaryEntry(matcher, "api")?.term).toBe("API");
    expect(lookupGlossaryEntry(matcher, "无关词")).toBeNull();
    expect(lookupGlossaryEntry(null, "API")).toBeNull();
  });

  it("keeps the first source's entry when multiple glossaries define the same term", () => {
    const handwritten: GlossarySource = {
      pluginId: "tech-glossary",
      pluginName: "技术名词解释",
      document: {
        version: 1,
        terms: [{ term: "缓存", explanation: "把常用调料放灶台边。" }],
      },
    };
    const mdn: GlossarySource = {
      pluginId: "tech-glossary-mdn",
      pluginName: "MDN 术语库",
      document: {
        version: 1,
        terms: [
          {
            term: "缓存",
            aliases: ["Cache"],
            explanation: "临时存储 HTTP 响应的组件。",
          },
          { term: "密文", explanation: "被打乱的信息。" },
        ],
      },
    };
    const matcher = buildGlossaryMatcher([handwritten, mdn]);
    // 同词条先到先得：手写包的比喻式解释赢
    expect(lookupGlossaryEntry(matcher, "缓存")?.pluginId).toBe(
      "tech-glossary",
    );
    // 后来源的独有词条与别名仍然生效
    expect(lookupGlossaryEntry(matcher, "密文")?.pluginId).toBe(
      "tech-glossary-mdn",
    );
    expect(lookupGlossaryEntry(matcher, "cache")?.pluginId).toBe(
      "tech-glossary-mdn",
    );
  });

  it("prefers longer terms over shorter overlapping ones", () => {
    const matcher = buildGlossaryMatcher([
      buildSource([{ term: "SQL 注入" }, { term: "注入" }]),
    ]);
    const matches = findGlossaryMatches(matcher!, "防范 SQL 注入攻击");
    expect(matches[0]?.text).toBe("SQL 注入");
    // 长词命中后不再重叠命中短词
    expect(matches.map((m) => m.text)).toEqual(["SQL 注入"]);
  });
});

type TestHastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: TestHastNode[];
};

function runPlugin(
  tree: TestHastNode,
  sources: GlossarySource[],
): TestHastNode {
  const matcher = buildGlossaryMatcher(sources);
  expect(matcher).not.toBeNull();
  createGlossaryRehypePlugin(matcher!)()(tree);
  return tree;
}

function paragraph(...children: TestHastNode[]): TestHastNode {
  return { type: "element", tagName: "p", properties: {}, children };
}

function text(value: string): TestHastNode {
  return { type: "text", value };
}

describe("createGlossaryRehypePlugin", () => {
  it("wraps matched terms into glossary-term elements", () => {
    const tree: TestHastNode = {
      type: "root",
      children: [paragraph(text("先部署再回滚。"))],
    };
    runPlugin(tree, [buildSource([{ term: "部署" }, { term: "回滚" }])]);
    const children = tree.children![0]!.children!;
    expect(children.map((node) => node.tagName ?? node.type)).toEqual([
      "text",
      GLOSSARY_TERM_TAG,
      "text",
      GLOSSARY_TERM_TAG,
      "text",
    ]);
    expect(children[1]!.children![0]!.value).toBe("部署");
    expect(children[3]!.children![0]!.value).toBe("回滚");
  });

  it("marks only the first occurrence per message", () => {
    const tree: TestHastNode = {
      type: "root",
      children: [
        paragraph(text("部署很重要，部署要谨慎。")),
        paragraph(text("再次强调部署。")),
      ],
    };
    runPlugin(tree, [buildSource([{ term: "部署" }])]);
    const marked = JSON.stringify(tree).split(GLOSSARY_TERM_TAG).length - 1;
    expect(marked).toBe(1);
  });

  it("skips code, links and katex subtrees", () => {
    const tree: TestHastNode = {
      type: "root",
      children: [
        paragraph(
          {
            type: "element",
            tagName: "code",
            properties: {},
            children: [text("部署脚本")],
          },
          {
            type: "element",
            tagName: "a",
            properties: {},
            children: [text("部署文档")],
          },
          {
            type: "element",
            tagName: "span",
            properties: { className: ["katex"] },
            children: [text("部署公式")],
          },
        ),
      ],
    };
    runPlugin(tree, [buildSource([{ term: "部署" }])]);
    expect(JSON.stringify(tree)).not.toContain(GLOSSARY_TERM_TAG);
  });

  it("leaves untouched text as a single node", () => {
    const tree: TestHastNode = {
      type: "root",
      children: [paragraph(text("这里没有任何术语。"))],
    };
    runPlugin(tree, [buildSource([{ term: "部署" }])]);
    expect(tree.children![0]!.children).toHaveLength(1);
    expect(tree.children![0]!.children![0]!.type).toBe("text");
  });
});
