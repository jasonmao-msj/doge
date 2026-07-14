// 插件基类与扩展点 —— 对准 CC GUI 宿主表面。
//
// 骨架借 Obsidian（Plugin extends Component + addCommand / addSettingTab /
// loadData / saveData），扩展点换成 CC GUI 自己的：文件预览器、消息装饰器。
// 运行时由宿主注入真身；本包仅为类型契约。

import { Component } from "./component";
import type { App } from "./app";
import type { PluginManifest } from "./manifest";
import type { PluginSettingTab } from "./ui";

/** 命令定义（借 Obsidian Command，去掉笔记编辑器相关回调）。 */
export interface Command {
  /** 插件内唯一 ID；宿主会自动加插件 id 前缀。 */
  id: string;
  /** 命令面板展示名。 */
  name: string;
  /** 可选图标名。 */
  icon?: string;
  /** 简单回调：直接执行。 */
  callback?: () => void | Promise<void>;
  /**
   * 条件回调，覆盖 callback。checking=true 时只判定「当前能否执行」
   * （返回 false 则命令从面板隐藏）；checking=false 时真正执行。
   */
  checkCallback?: (checking: boolean) => boolean | void;
}

/** 文件预览器上下文（宿主注入）。 */
export interface FileViewerContext {
  /** 工作区相对路径。 */
  readonly filePath: string;
  /** 读取该文件文本（受控，带路径逃逸防护）。 */
  readFile(): Promise<string>;
}

/** 文件预览器扩展点（升级旧 viewer 能力）。 */
export interface FileViewerSpec {
  /**
   * 匹配哪些文件：字符串（`**\/*.后缀` 后缀匹配，或精确文件名），
   * 或自定义判定函数。
   */
  match: string | ((filePath: string) => boolean);
  /** 预览标题。 */
  title?: string;
  /**
   * 渲染：宿主在右侧面板给你一块 DOM 容器，自己往里渲染。
   * 可返回一个清理函数，面板关闭时调用。
   */
  mount(container: HTMLElement, context: FileViewerContext): void | (() => void);
}

/** 消息装饰器上下文（宿主注入）。 */
export interface MessageContext {
  readonly threadId: string;
  readonly role: "assistant" | "user";
  /** 消息原始文本。 */
  readonly sourceText: string;
}

/** 消息装饰器扩展点（升级旧 glossary 能力；术语高亮 = 它的第一个消费者）。 */
export interface MessageDecorator {
  /**
   * 对一条渲染完成的 AI 消息 DOM 做后处理（命令式，
   * 对应 Obsidian 的 markdownPostProcessor）。
   */
  process(el: HTMLElement, context: MessageContext): void | Promise<void>;
}

/**
 * 插件基类。extends Component —— 天然拥有生命周期与 register* 自动清理。
 * 覆写 onload 注册命令 / 视图 / 装饰器 / 设置页；卸载时 register* 登记的一切自动释放。
 */
export declare abstract class Plugin extends Component {
  /** 宿主能力面。 */
  readonly app: App;
  /** 本插件清单。 */
  readonly manifest: PluginManifest;
  /** 插件设置；在 onload 里用 loadData() 赋值，子类可声明具体类型。 */
  settings?: unknown;
  constructor(app: App, manifest: PluginManifest);
  /** 覆写：插件加载入口。 */
  onload(): void | Promise<void>;

  // —— 扩展点（对准 CC GUI 宿主表面）——
  /** 注册一条命令（进命令面板）；卸载时自动移除。 */
  addCommand(command: Command): Command;
  /** 手动移除命令（一般无需，卸载会自动清）。 */
  removeCommand(commandId: string): void;
  /** 注册设置页。 */
  addSettingTab(tab: PluginSettingTab): void;
  /** 注册文件预览器（右侧面板）；卸载时自动注销。 */
  registerFileViewer(spec: FileViewerSpec): void;
  /** 注册 AI 消息装饰器（渲染管线）；卸载时自动注销。 */
  registerMessageDecorator(decorator: MessageDecorator): void;

  // —— 数据持久化 ——
  /** 从插件目录的 data.json 读设置。 */
  loadData(): Promise<unknown>;
  /** 写设置到插件目录的 data.json。 */
  saveData(data: unknown): Promise<void>;
}
