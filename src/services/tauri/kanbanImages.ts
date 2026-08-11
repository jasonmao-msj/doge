import { invoke } from "@tauri-apps/api/core";

/**
 * 将 base64 image data URL 落盘为 `~/.doge/client/kanban-images/` 下的文件，
 * 返回绝对路径。避免把 MB 级 base64 存进 client store JSON。
 */
export async function saveKanbanImage(dataUrl: string): Promise<string> {
  return invoke("client_save_kanban_image", { dataUrl });
}
