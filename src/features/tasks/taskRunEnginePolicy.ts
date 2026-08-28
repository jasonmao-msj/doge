import type { EngineType } from "../../types";
import {
  isEngineExecutionEnabled,
  type ExecutableEngineType,
} from "../../utils/engineExecutionPolicy";

export type PersistedTaskRunEngine = EngineType;

export type NewTaskRunEngine = ExecutableEngineType;

export function isPersistedTaskRunEngine(
  engine: unknown,
): engine is PersistedTaskRunEngine {
  return (
    engine === "claude" ||
    engine === "codex" ||
    engine === "gemini" ||
    engine === "kimi" ||
    engine === "grok" ||
    engine === "opencode"
  );
}

export function isNewTaskRunEngine(
  engine: unknown,
): engine is NewTaskRunEngine {
  return isEngineExecutionEnabled(engine);
}
