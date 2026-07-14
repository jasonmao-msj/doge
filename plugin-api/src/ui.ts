// UI 原语 —— 借 Obsidian 的形状（平台无关），实现接 CC GUI 的 toast / shadcn 风格。

import { Component } from "./component";
import type { App } from "./app";

/** 轻提示句柄。由 App.notice 创建即显示。 */
export declare class Notice {
  /** 提示消息 DOM，可进一步定制。 */
  readonly messageEl: HTMLElement;
  /** 更新消息文本。 */
  setMessage(message: string): this;
  /** 主动关闭。 */
  hide(): void;
}

/**
 * 模态弹窗基类。extends Component —— 关闭即卸载，register* 自动清理。
 * 覆写 onOpen 往 contentEl 塞 DOM。
 */
export declare abstract class Modal extends Component {
  readonly app: App;
  /** 弹窗内容容器，往这里塞你的 DOM。 */
  readonly contentEl: HTMLElement;
  constructor(app: App);
  /** 打开弹窗。 */
  open(): void;
  /** 关闭弹窗。 */
  close(): void;
  /** 覆写：弹窗打开时渲染内容。 */
  onOpen(): void | Promise<void>;
  /** 覆写：弹窗关闭时清理。 */
  onClose(): void;
}

/** 开关控件（Setting.addToggle 回调拿到）。 */
export interface ToggleControl {
  getValue(): boolean;
  setValue(value: boolean): this;
  onChange(cb: (value: boolean) => void): this;
}

/** 文本输入控件（Setting.addText 回调拿到）。 */
export interface TextControl {
  getValue(): string;
  setValue(value: string): this;
  setPlaceholder(text: string): this;
  onChange(cb: (value: string) => void): this;
}

/** 按钮控件（Setting.addButton 回调拿到）。 */
export interface ButtonControl {
  setLabel(label: string): this;
  /** 标为主行动按钮（primary 样式）。 */
  setCta(): this;
  onClick(cb: () => void): this;
}

/**
 * 单行设置控件，链式 builder（借 Obsidian 的 Setting 手感）。
 * 宿主用 CC GUI 的 shadcn 风格渲染这些控件。
 */
export declare class Setting {
  constructor(containerEl: HTMLElement);
  setName(name: string): this;
  setDesc(desc: string): this;
  addToggle(cb: (toggle: ToggleControl) => void): this;
  addText(cb: (text: TextControl) => void): this;
  addButton(cb: (button: ButtonControl) => void): this;
}

/**
 * 插件设置页基类。由 Plugin.addSettingTab 注册，出现在设置面板。
 * 覆写 display() 往 containerEl 用 Setting builder 渲染。
 */
export declare abstract class PluginSettingTab extends Component {
  readonly app: App;
  /** 设置页根容器。 */
  readonly containerEl: HTMLElement;
  constructor(app: App);
  /** 覆写：渲染设置项。 */
  abstract display(): void;
  /** 清空设置页内容。 */
  hide(): void;
}
