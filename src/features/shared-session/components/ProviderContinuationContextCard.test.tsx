// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConversationItem } from "../../../types";
import { ProviderContinuationContextCard } from "./ProviderContinuationContextCard";
import { buildProviderContinuationSourceExcerpt } from "./providerContinuationSourceExcerpt";

const TARGET = {
  id: "codex:target",
  name: "继续：修复登录问题",
  updatedAt: 2,
  engineSource: "codex" as const,
  providerProfileName: "Provider B",
  originKind: "provider-continuation",
  sourceSessionId: "claude:source",
};

describe("ProviderContinuationContextCard", () => {
  it("shows readable lineage and opens the source", () => {
    const onOpenSource = vi.fn();
    render(
      <ProviderContinuationContextCard
        thread={TARGET}
        source={{
          id: "claude:source",
          name: "修复登录问题",
          updatedAt: 1,
          engineSource: "claude",
          providerProfileName: "Provider A",
        }}
        sourceExcerpt={{
          userText: "你是什么模型？",
          assistantText: "我是来源会话里的 Assistant。",
        }}
        onOpenSource={onOpenSource}
      />,
    );

    const details = screen.getByRole("group", {
      name: "Provider 续接上下文",
    }) as HTMLDetailsElement;
    const summary = details.querySelector("summary") as HTMLElement;
    expect(details.open).toBe(false);
    expect(details.className.split(" ")).toEqual(
      expect.arrayContaining([
        "provider-continuation-context-card",
        "sticky",
        "top-[calc(var(--main-topbar-height)+12px)]",
        "z-10",
        "bg-muted",
      ]),
    );
    expect(details.textContent).toContain("Claude · Provider A");
    expect(details.textContent).toContain("Codex · Provider B");
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getByText("你是什么模型？")).toBeTruthy();
    expect(screen.getByText("我是来源会话里的 Assistant。")).toBeTruthy();
    expect(screen.getByText("你是什么模型？").className).toContain(
      "line-clamp-2",
    );
    expect(
      screen.getByText("我是来源会话里的 Assistant。").className,
    ).toContain("line-clamp-3");
    const openSourceButton = screen.getByRole("button", {
      name: "查看来源会话",
    });
    expect(openSourceButton.textContent).toBe("");
    expect(openSourceButton.className.split(" ")).toEqual(
      expect.arrayContaining([
        "size-7",
        "border-0",
        "bg-transparent",
        "p-0",
      ]),
    );
    fireEvent.click(openSourceButton);
    expect(onOpenSource).toHaveBeenCalledOnce();
    fireEvent.click(summary);
    expect(details.open).toBe(false);
  });

  it("keeps frozen target identity when the source is missing", () => {
    render(
      <ProviderContinuationContextCard
        thread={TARGET}
        source={null}
        sourceExcerpt={null}
        onOpenSource={null}
      />,
    );

    expect(screen.getByText(/来源会话已不可用/)).toBeTruthy();
    expect(
      screen.getByRole("group", { name: "Provider 续接上下文" }).textContent,
    ).toContain("Claude · 来源 Provider");
    expect(
      (
        screen.getByRole("button", {
          name: "查看来源会话",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("shows a user-only excerpt without inventing an assistant reply", () => {
    render(
      <ProviderContinuationContextCard
        thread={TARGET}
        source={{
          id: "claude:source",
          name: "修复登录问题",
          updatedAt: 1,
          engineSource: "claude",
        }}
        sourceExcerpt={{
          userText: "继续检查边界。",
          assistantText: null,
        }}
        onOpenSource={vi.fn()}
      />,
    );

    fireEvent.click(
      screen
        .getByRole("group", { name: "Provider 续接上下文" })
        .querySelector("summary") as HTMLElement,
    );
    expect(screen.getByText("继续检查边界。")).toBeTruthy();
    expect(screen.queryByText("助手")).toBeNull();
  });

  it("shows a fallback when source messages are not loaded", () => {
    render(
      <ProviderContinuationContextCard
        thread={TARGET}
        source={{
          id: "claude:source",
          name: "修复登录问题",
          updatedAt: 1,
          engineSource: "claude",
        }}
        sourceExcerpt={null}
        onOpenSource={vi.fn()}
      />,
    );

    expect(screen.getByText("来源内容暂无可用摘录")).toBeTruthy();
  });
});

describe("buildProviderContinuationSourceExcerpt", () => {
  it("extracts the latest readable turn and ignores trailing non-message items", () => {
    const items: ConversationItem[] = [
      { id: "u1", kind: "message", role: "user", text: "旧问题" },
      { id: "a1", kind: "message", role: "assistant", text: "旧回答" },
      { id: "u2", kind: "message", role: "user", text: "  最新问题  " },
      {
        id: "a2-empty",
        kind: "message",
        role: "assistant",
        text: "   ",
      },
      {
        id: "a2",
        kind: "message",
        role: "assistant",
        text: "  最新回答  ",
      },
      {
        id: "tool",
        kind: "tool",
        toolType: "shell",
        title: "检查",
        detail: "",
      },
      { id: "reasoning", kind: "reasoning", summary: "", content: "思考" },
    ];

    expect(buildProviderContinuationSourceExcerpt(items)).toEqual({
      userText: "最新问题",
      assistantText: "最新回答",
    });
  });

  it("keeps an incomplete user turn and supports assistant-only history", () => {
    expect(
      buildProviderContinuationSourceExcerpt([
        { id: "a1", kind: "message", role: "assistant", text: "旧回答" },
        { id: "u1", kind: "message", role: "user", text: "新问题" },
      ]),
    ).toEqual({
      userText: "新问题",
      assistantText: null,
    });

    expect(
      buildProviderContinuationSourceExcerpt([
        { id: "a1", kind: "message", role: "assistant", text: "仅有回答" },
      ]),
    ).toEqual({
      userText: null,
      assistantText: "仅有回答",
    });
    expect(buildProviderContinuationSourceExcerpt([])).toBeNull();
  });
});
