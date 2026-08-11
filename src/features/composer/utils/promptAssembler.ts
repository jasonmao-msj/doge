import type { SkillInvocation } from "../../../types/conversation";

export type { SkillInvocation };

type SkillPromptInput = {
  name: string;
  description?: string;
  path?: string;
};

type AssembleSinglePromptInput = {
  userInput: string;
  skills: SkillPromptInput[];
  commons: { name: string }[];
};

type AssemblePanelPromptInput = {
  workspaceQuestion: string;
  panelSkill: SkillPromptInput;
  inheritedCommons: { name: string }[];
  panelExtraInput?: string;
};

function toSlashToken(name: string) {
  const trimmed = name.trim().replace(/^\/+/, "");
  if (!trimmed) {
    return "";
  }
  return `/${trimmed.replace(/\s+/g, "-")}`;
}

const MANAGED_COMMAND_SOURCE = "workspace_managed";
const LEADING_COMMAND_RE = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/;

/**
 * 将开头的 `/<managed 命令> [args]` 展开为命令正文：managed 目录是
 * doge 私有注册表（workspace_context），引擎只认项目/全局 `.claude` 等
 * 目录（engine_injected），因此 managed 命令必须在客户端展开后发送。
 * 正文含 `$ARGUMENTS` 时全部替换为参数；无占位符时参数追加在正文后。
 * 非 managed（引擎可解析）或未知命令原样返回，交给引擎处理/报错。
 */
export function expandLeadingManagedCommand(
  text: string,
  commands: { name: string; content: string; source?: string }[],
): string {
  const match = LEADING_COMMAND_RE.exec(text.trim());
  if (!match) {
    return text;
  }
  const commandName = (match[1] ?? "").toLowerCase();
  const command = commands.find(
    (item) =>
      item.source === MANAGED_COMMAND_SOURCE &&
      item.name.trim().toLowerCase() === commandName,
  );
  const content = command?.content.trim() ?? "";
  if (!command || !content) {
    return text;
  }
  const args = (match[2] ?? "").trim();
  if (content.includes("$ARGUMENTS")) {
    return content.split("$ARGUMENTS").join(args);
  }
  return args ? `${content}\n\n${args}` : content;
}

/** 与 toSlashToken 同一归一化规则的结构化形式（无 `/` 前缀；附 path 供协作正文注入）。 */
export function assembleSkillInvocations(input: {
  skills: SkillPromptInput[];
  commons: Array<{ name: string; path?: string }>;
}): SkillInvocation[] {
  const entries = [
    ...input.skills.map((skill) => ({
      name: skill.name,
      path: skill.path,
    })),
    ...input.commons.map((common) => ({
      name: common.name,
      path: common.path,
    })),
  ];
  const seen = new Set<string>();
  const invocations: SkillInvocation[] = [];
  for (const entry of entries) {
    const name = toSlashToken(entry.name).replace(/^\/+/, "");
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const path = entry.path?.trim();
    invocations.push(path ? { name, path } : { name });
  }
  return invocations;
}

export function shouldAssemblePrompt(input: {
  userInput: string;
  selectedSkillCount: number;
  selectedCommonsCount: number;
}) {
  const trimmed = input.userInput.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("/")) {
    return false;
  }
  return input.selectedSkillCount > 0 || input.selectedCommonsCount > 0;
}

export function assembleSinglePrompt(input: AssembleSinglePromptInput) {
  const userInput = input.userInput.trim();
  if (!userInput) {
    return "";
  }
  const tokens = [
    ...input.skills.map((skill) => toSlashToken(skill.name)).filter(Boolean),
    ...input.commons.map((common) => toSlashToken(common.name)).filter(Boolean),
  ];
  if (tokens.length === 0) {
    return userInput;
  }
  return `${tokens.join(" ")} ${userInput}`;
}

export function assemblePanelPrompt(input: AssemblePanelPromptInput) {
  const question = input.workspaceQuestion.trim();
  if (!question) {
    return "";
  }
  const tokens = [toSlashToken(input.panelSkill.name)];
  tokens.push(
    ...input.inheritedCommons.map((common) => toSlashToken(common.name)).filter(Boolean),
  );
  const extraInput = input.panelExtraInput?.trim();
  if (extraInput && !extraInput.startsWith("/")) {
    tokens.push(toSlashToken(extraInput));
  }
  const validTokens = tokens.filter(Boolean);
  if (validTokens.length === 0) {
    return question;
  }
  return `${validTokens.join(" ")} ${question}`;
}
