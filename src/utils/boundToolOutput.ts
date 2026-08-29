import { isToolOutputBudgetEnabled } from "@/conversation-presentation/realtimePerfFlags";

export const COMMAND_EXECUTION_OUTPUT_BUDGET = 256 * 1024;
export const COMMAND_EXECUTION_OUTPUT_HEAD = 64 * 1024;
export const FILE_CHANGE_OUTPUT_BUDGET = 1024 * 1024;
export const FILE_CHANGE_OUTPUT_HEAD = 128 * 1024;

const OMITTED_MARKER_RE = /\n…\[omitted (\d+) chars\]…\n/;

type OutputBudgetSpec = { budget: number; head: number };

function resolveBudgetSpec(kind: string): OutputBudgetSpec | null {
  if (kind === "commandExecution") {
    return { budget: COMMAND_EXECUTION_OUTPUT_BUDGET, head: COMMAND_EXECUTION_OUTPUT_HEAD };
  }
  if (kind === "fileChange") {
    return { budget: FILE_CHANGE_OUTPUT_BUDGET, head: FILE_CHANGE_OUTPUT_HEAD };
  }
  return null;
}

function formatOmittedMarker(omittedChars: number) {
  return `\n…[omitted ${omittedChars} chars]…\n`;
}

function parseBoundedOutput(text: string) {
  const match = OMITTED_MARKER_RE.exec(text);
  if (!match || match.index === undefined) return null;
  const omitted = Number(match[1]);
  if (!Number.isFinite(omitted) || omitted < 0) return null;
  return {
    head: text.slice(0, match.index),
    omitted,
    tail: text.slice(match.index + match[0].length),
  };
}

function assembleBoundedOutput(head: string, tail: string, omittedChars: number) {
  return omittedChars <= 0
    ? `${head}${tail}`
    : `${head}${formatOmittedMarker(omittedChars)}${tail}`;
}

function fitBoundedOutput(
  head: string,
  tail: string,
  omittedChars: number,
  budget: number,
) {
  let nextTail = tail;
  let nextOmitted = Math.max(0, omittedChars);
  let result = assembleBoundedOutput(head, nextTail, nextOmitted);
  while (result.length > budget && nextTail.length > 0) {
    const overflow = result.length - budget;
    nextTail = nextTail.slice(overflow);
    nextOmitted += overflow;
    result = assembleBoundedOutput(head, nextTail, nextOmitted);
  }
  return result.length > budget ? head.slice(0, budget) : result;
}

function boundFreshText(text: string, spec: OutputBudgetSpec) {
  if (text.length <= spec.budget) return text;
  const head = text.slice(0, Math.min(spec.head, spec.budget));
  const remaining = Math.max(0, spec.budget - head.length);
  const tail = text.slice(Math.max(head.length, text.length - remaining));
  return fitBoundedOutput(
    head,
    tail,
    Math.max(0, text.length - head.length - tail.length),
    spec.budget,
  );
}

export function boundToolOutput(
  text: string | null | undefined,
  kind: string,
): string {
  const raw = text ?? "";
  if (!raw || !isToolOutputBudgetEnabled()) return raw;
  const spec = resolveBudgetSpec(kind);
  if (!spec) return raw;
  const parsed = parseBoundedOutput(raw);
  return parsed
    ? fitBoundedOutput(parsed.head, parsed.tail, parsed.omitted, spec.budget)
    : boundFreshText(raw, spec);
}
