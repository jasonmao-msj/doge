// @ccgui/plugin —— 插件开发 API 类型契约。
// 第三方插件 `import { Plugin, Notice } from "@ccgui/plugin"` 拿到类型；
// 打包时把本包标为 external，运行时由宿主 require 注入真身（同 Obsidian 模型）。

export type { PluginManifest, PluginSkillDeclaration } from "./manifest";
export { Component } from "./component";
export type { App, Workspace, FileSystem } from "./app";
export { Notice, Modal, Setting, PluginSettingTab } from "./ui";
export type { ToggleControl, TextControl, ButtonControl } from "./ui";
export { Plugin } from "./plugin";
export type {
  Command,
  FileViewerSpec,
  FileViewerContext,
  MessageDecorator,
  MessageContext,
} from "./plugin";
