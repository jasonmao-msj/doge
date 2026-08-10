import { describe, expect, it } from "vitest";

import {
  classifyContextProtocolText,
  filterContextProtocolConversationItems,
  hasContextProtocolControlTail,
  isDogeProgramControlTitle,
  DOGE_PROGRAM_CONTROL_TITLE_TOKENS,
} from "./contextProtocol";

const PACKAGE = `sha256:${"a".repeat(64)}`;
const CHECKSUM = `sha256:${"b".repeat(64)}`;

describe("classifyContextProtocolText", () => {
  it("recognizes exact package and acceptance markers", () => {
    expect(
      classifyContextProtocolText(
        `DOGE_CONTEXT_PACKAGE:${PACKAGE}:${CHECKSUM}`,
      ),
    ).toBe("context-package");
    expect(
      classifyContextProtocolText(
        `DOGE_CONTEXT_ACCEPTED:${PACKAGE}:${CHECKSUM}`,
      ),
    ).toBe("context-accepted");
    expect(
      classifyContextProtocolText(
        `MOSSX_CONTEXT_PACKAGE:${PACKAGE}:${CHECKSUM}`,
      ),
    ).toBe("context-package");
    expect(
      classifyContextProtocolText(
        `MOSSX_CONTEXT_ACCEPTED:${PACKAGE}:${CHECKSUM}`,
      ),
    ).toBe("context-accepted");
  });

  it("recognizes a complete native context prompt prefix", () => {
    expect(
      classifyContextProtocolText(
        `MOSSX_CONTEXT_PACKAGE:${PACKAGE}:${CHECKSUM}\n` +
          "MOSSX_NATIVE_CONTEXT_V1\n" +
          "source:claude:source-id\n" +
          "binding:codex:provider-id\n\n" +
          "Shared Context Transcript",
      ),
    ).toBe("native-context-prompt");
  });

  it("recognizes only a complete Shared Runtime prompt envelope", () => {
    const marker = `MOSSX_CONTEXT_PACKAGE:${PACKAGE}:${CHECKSUM}`;
    expect(
      classifyContextProtocolText(
        `${marker}\n` +
          "MOSSX_SHARED_CONTEXT_V1\n" +
          "session:shared-session-1\n" +
          "binding:codex::managed-a\n\n" +
          "Shared Context Transcript\n\nTurn 1\nUser: 你好\n" +
          `${marker}\n\n` +
          "Current user request:\n继续修复",
      ),
    ).toBe("shared-runtime-prompt");

    expect(
      classifyContextProtocolText(
        `${marker}\n` +
          "MOSSX_SHARED_CONTEXT_V1\n" +
          "session:shared-session-1\n" +
          "binding:codex::managed-a\n\n" +
          "Shared Context Transcript\n" +
          `MOSSX_CONTEXT_PACKAGE:${CHECKSUM}:${PACKAGE}\n\n` +
          "Current user request:\n继续修复",
      ),
    ).toBeNull();
  });

  it("preserves ordinary user text that merely mentions MOSSX", () => {
    expect(
      classifyContextProtocolText(
        "请解释 MOSSX_CONTEXT_PACKAGE 是什么，不要隐藏这条消息",
      ),
    ).toBeNull();
    expect(
      classifyContextProtocolText(
        "MOSSX_CONTEXT_PACKAGE:sha256:not-a-hash:sha256:not-a-hash",
      ),
    ).toBeNull();
    expect(
      classifyContextProtocolText(
        "请解释 MOSSX_SHARED_CONTEXT_V1 和 Current user request 的作用",
      ),
    ).toBeNull();
  });
});

describe("isDogeProgramControlTitle", () => {
  it("lists the full runtime control token inventory", () => {
    expect([...DOGE_PROGRAM_CONTROL_TITLE_TOKENS]).toEqual([
      "DOGE_CONTEXT_PACKAGE",
      "DOGE_CONTEXT_ACCEPTED",
      "DOGE_NATIVE_CONTEXT_V1",
      "DOGE_SHARED_CONTEXT_V1",
      "MOSSX_CONTEXT_PACKAGE",
      "MOSSX_CONTEXT_ACCEPTED",
      "MOSSX_NATIVE_CONTEXT_V1",
      "MOSSX_SHARED_CONTEXT_V1",
    ]);
  });

  it("matches line-start MOSSX_ titles including truncated package hashes", () => {
    for (const token of DOGE_PROGRAM_CONTROL_TITLE_TOKENS) {
      expect(isDogeProgramControlTitle(`${token}:partial`)).toBe(true);
    }
    expect(
      isDogeProgramControlTitle("MOSSX_CONTEXT_PACKAGE:sha25…"),
    ).toBe(true);
    expect(isDogeProgramControlTitle("  MOSSX_SHARED_CONTEXT_V1\nbody")).toBe(
      true,
    );
  });

  it("does not match user prose that only mentions MOSSX mid-sentence", () => {
    expect(
      isDogeProgramControlTitle(
        "请解释 MOSSX_CONTEXT_PACKAGE 是什么，不要隐藏这条消息",
      ),
    ).toBe(false);
    expect(isDogeProgramControlTitle("Agent 12")).toBe(false);
    expect(isDogeProgramControlTitle("")).toBe(false);
  });
});

describe("filterContextProtocolConversationItems", () => {
  it("removes the complete bootstrap exchange until the first real user turn", () => {
    const packageId = `sha256:${"a".repeat(64)}`;
    const checksum = `sha256:${"b".repeat(64)}`;
    const items = [
      {
        id: "bootstrap-user",
        kind: "message" as const,
        role: "user" as const,
        text:
          `MOSSX_CONTEXT_PACKAGE:${packageId}:${checksum}\n` +
          "MOSSX_NATIVE_CONTEXT_V1\nsource:claude:source\nbinding:continuation:op\n",
      },
      {
        id: "bootstrap-reasoning",
        kind: "reasoning" as const,
        summary: "bootstrap",
        content: "processing context",
      },
      {
        id: "bootstrap-assistant",
        kind: "message" as const,
        role: "assistant" as const,
        text: "你好，我是 Claude。",
      },
      {
        id: "real-user",
        kind: "message" as const,
        role: "user" as const,
        text: "继续修复问题",
      },
      {
        id: "real-assistant",
        kind: "message" as const,
        role: "assistant" as const,
        text: "开始处理。",
      },
    ];

    expect(filterContextProtocolConversationItems(items).map((item) => item.id)).toEqual([
      "real-user",
      "real-assistant",
    ]);
    expect(hasContextProtocolControlTail(items.slice(0, 3))).toBe(true);
    expect(hasContextProtocolControlTail(items)).toBe(false);
  });

  it("removes only a Shared Runtime user echo and keeps the assistant turn", () => {
    const marker = `MOSSX_CONTEXT_PACKAGE:${PACKAGE}:${CHECKSUM}`;
    const items = [
      {
        id: "canonical-user",
        kind: "message" as const,
        role: "user" as const,
        text: "继续修复",
      },
      {
        id: "runtime-user-echo",
        kind: "message" as const,
        role: "user" as const,
        text:
          `${marker}\n` +
          "MOSSX_SHARED_CONTEXT_V1\n" +
          "session:shared-session-1\n" +
          "binding:codex::managed-a\n\n" +
          "Shared Context Transcript\n\nTurn 1\nUser: 你好\n" +
          `${marker}\n\n` +
          "Current user request:\n继续修复",
      },
      {
        id: "runtime-reasoning",
        kind: "reasoning" as const,
        summary: "思考过程",
        content: "定位问题",
      },
      {
        id: "runtime-assistant",
        kind: "message" as const,
        role: "assistant" as const,
        text: "已经修复。",
      },
    ];

    expect(filterContextProtocolConversationItems(items).map((item) => item.id)).toEqual([
      "canonical-user",
      "runtime-reasoning",
      "runtime-assistant",
    ]);
    expect(hasContextProtocolControlTail(items.slice(0, 2))).toBe(false);
  });

  it("hides the leading Codex host bootstrap only for Provider Continuation", () => {
    const marker = `MOSSX_CONTEXT_PACKAGE:${PACKAGE}:${CHECKSUM}`;
    const items = [
      {
        id: "codex-environment",
        kind: "message" as const,
        role: "user" as const,
        text:
          "<environment_context>\n" +
          "  <cwd>/workspace</cwd>\n" +
          "  <shell>zsh</shell>\n" +
          "</environment_context>",
      },
      {
        id: "runtime-user-echo",
        kind: "message" as const,
        role: "user" as const,
        text:
          `${marker}\n` +
          "MOSSX_SHARED_CONTEXT_V1\n" +
          "session:shared-session-1\n" +
          "binding:codex::managed-a\n\n" +
          "Shared Context Transcript\n\nTurn 1\nUser: 你好\n" +
          `${marker}\n\n` +
          "Current user request:\n继续修复",
      },
      {
        id: "bootstrap-assistant",
        kind: "message" as const,
        role: "assistant" as const,
        text: "你好！我是 MiniMax。",
      },
      {
        id: "real-user",
        kind: "message" as const,
        role: "user" as const,
        text: "继续处理真实问题",
      },
      {
        id: "real-assistant",
        kind: "message" as const,
        role: "assistant" as const,
        text: "开始处理。",
      },
    ];
    const continuationOptions = {
      hideLeadingContinuationBootstrap: true,
    };

    expect(
      filterContextProtocolConversationItems(items, continuationOptions).map(
        (item) => item.id,
      ),
    ).toEqual(["real-user", "real-assistant"]);
    expect(
      hasContextProtocolControlTail(items.slice(0, 3), continuationOptions),
    ).toBe(true);
    expect(hasContextProtocolControlTail(items, continuationOptions)).toBe(
      false,
    );

    expect(filterContextProtocolConversationItems(items).map((item) => item.id)).toEqual([
      "codex-environment",
      "bootstrap-assistant",
      "real-user",
      "real-assistant",
    ]);
  });

  it("hides an incremental Codex environment item before the control marker arrives", () => {
    const items = [
      {
        id: "codex-environment",
        kind: "message" as const,
        role: "user" as const,
        text:
          "<environment_context><cwd>/workspace</cwd></environment_context>",
      },
    ];
    const continuationOptions = {
      hideLeadingContinuationBootstrap: true,
    };

    expect(
      filterContextProtocolConversationItems(items, continuationOptions),
    ).toEqual([]);
    expect(hasContextProtocolControlTail(items, continuationOptions)).toBe(true);
    expect(filterContextProtocolConversationItems(items)).toEqual(items);
  });

  it("hides a nested structured import envelope including imported user items", () => {
    const outerPackage = `sha256:${"c".repeat(64)}`;
    const outerChecksum = `sha256:${"d".repeat(64)}`;
    const innerPackage = `sha256:${"e".repeat(64)}`;
    const innerChecksum = `sha256:${"f".repeat(64)}`;
    const items = [
      {
        id: "outer-package",
        kind: "message" as const,
        role: "user" as const,
        text: `MOSSX_CONTEXT_PACKAGE:${outerPackage}:${outerChecksum}`,
      },
      {
        id: "imported-environment",
        kind: "message" as const,
        role: "user" as const,
        text: "<environment_context><cwd>/workspace</cwd></environment_context>",
      },
      {
        id: "inner-package",
        kind: "message" as const,
        role: "user" as const,
        text: `MOSSX_CONTEXT_PACKAGE:${innerPackage}:${innerChecksum}`,
      },
      {
        id: "imported-instructions",
        kind: "message" as const,
        role: "user" as const,
        text: "# AGENTS.md instructions",
      },
      {
        id: "inner-accepted",
        kind: "message" as const,
        role: "user" as const,
        text: `MOSSX_CONTEXT_ACCEPTED:${innerPackage}:${innerChecksum}`,
      },
      {
        id: "imported-user-after-inner",
        kind: "message" as const,
        role: "user" as const,
        text: "1+1",
      },
      {
        id: "outer-accepted",
        kind: "message" as const,
        role: "user" as const,
        text: `MOSSX_CONTEXT_ACCEPTED:${outerPackage}:${outerChecksum}`,
      },
      {
        id: "real-user",
        kind: "message" as const,
        role: "user" as const,
        text: "继续处理新问题",
      },
      {
        id: "real-assistant",
        kind: "message" as const,
        role: "assistant" as const,
        text: "开始处理。",
      },
    ];

    expect(filterContextProtocolConversationItems(items).map((item) => item.id)).toEqual([
      "real-user",
      "real-assistant",
    ]);
    expect(hasContextProtocolControlTail(items.slice(0, 6))).toBe(true);
    expect(hasContextProtocolControlTail(items)).toBe(false);
  });

  it("lets the outer acceptance close an imported legacy package without acceptance", () => {
    const outerPackage = `sha256:${"1".repeat(64)}`;
    const outerChecksum = `sha256:${"2".repeat(64)}`;
    const legacyPackage = `sha256:${"3".repeat(64)}`;
    const legacyChecksum = `sha256:${"4".repeat(64)}`;
    const items = [
      {
        id: "outer-package",
        kind: "message" as const,
        role: "user" as const,
        text: `MOSSX_CONTEXT_PACKAGE:${outerPackage}:${outerChecksum}`,
      },
      {
        id: "legacy-package",
        kind: "message" as const,
        role: "user" as const,
        text: `MOSSX_CONTEXT_PACKAGE:${legacyPackage}:${legacyChecksum}`,
      },
      {
        id: "legacy-imported-user",
        kind: "message" as const,
        role: "user" as const,
        text: "旧版导入内容",
      },
      {
        id: "outer-accepted",
        kind: "message" as const,
        role: "user" as const,
        text: `MOSSX_CONTEXT_ACCEPTED:${outerPackage}:${outerChecksum}`,
      },
      {
        id: "real-user",
        kind: "message" as const,
        role: "user" as const,
        text: "第三次切换后的真实问题",
      },
    ];

    expect(filterContextProtocolConversationItems(items).map((item) => item.id)).toEqual([
      "real-user",
    ]);
    expect(hasContextProtocolControlTail(items.slice(0, 3))).toBe(true);
    expect(hasContextProtocolControlTail(items)).toBe(false);
  });
});
