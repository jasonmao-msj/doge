const MESSAGE_JUMP_EVENT_NAME = "doge:jump-to-message";

export function dispatchMessageJumpEvent(messageId: string) {
  if (!messageId || typeof document === "undefined") {
    return;
  }
  document.dispatchEvent(
    new CustomEvent<string>(MESSAGE_JUMP_EVENT_NAME, {
      detail: messageId,
    }),
  );
}
