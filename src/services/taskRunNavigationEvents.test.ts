// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  dispatchOpenTaskRunEvent,
  OPEN_TASK_RUN_EVENT,
  readOpenTaskRunEvent,
} from "./taskRunNavigationEvents";

describe("taskRunNavigationEvents", () => {
  it("dispatches and reads back the run id", () => {
    const received: Array<string | null> = [];
    const listener = (event: Event) => {
      received.push(readOpenTaskRunEvent(event));
    };

    window.addEventListener(OPEN_TASK_RUN_EVENT, listener);
    try {
      dispatchOpenTaskRunEvent("run-123");
    } finally {
      window.removeEventListener(OPEN_TASK_RUN_EVENT, listener);
    }

    expect(received).toEqual(["run-123"]);
  });

  it("ignores empty run ids", () => {
    const received: Array<string | null> = [];
    const listener = (event: Event) => {
      received.push(readOpenTaskRunEvent(event));
    };

    window.addEventListener(OPEN_TASK_RUN_EVENT, listener);
    try {
      dispatchOpenTaskRunEvent("   ");
    } finally {
      window.removeEventListener(OPEN_TASK_RUN_EVENT, listener);
    }

    expect(received).toEqual([]);
    expect(readOpenTaskRunEvent(new CustomEvent(OPEN_TASK_RUN_EVENT, { detail: {} }))).toBeNull();
  });
});
