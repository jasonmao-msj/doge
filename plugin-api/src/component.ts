// 组件生命周期基类 —— 借鉴 Obsidian 的 Component 骨架（平台无关部分）。
//
// 核心价值：任何 extends Component 的对象（Plugin / Modal / PluginSettingTab /
// 未来的面板视图）都自带「卸载时自动清理」能力。用 register* 登记的监听 /
// 定时器 / 回调，会在 unload() 时按登记逆序自动释放，插件作者无需手写 teardown
// —— 这是 Obsidian 插件不泄漏 listener 的根基。
//
// 本包仅提供类型契约；运行时由宿主注入真实实现（declare，无运行时代码）。

export declare abstract class Component {
  /** 由宿主调用：加载组件及其子组件，触发 onload()。插件通常不直接调。 */
  load(): void;
  /** 覆写此方法编写加载逻辑。 */
  onload(): void;
  /** 由宿主调用：卸载组件及其子组件（先卸子级），触发 onunload() 与已登记的清理。 */
  unload(): void;
  /** 覆写此方法编写卸载逻辑（register* 登记的清理会自动执行，无需在此重复）。 */
  onunload(): void;
  /** 挂一个子组件；父已加载则立即加载它，父卸载时级联卸载。 */
  addChild<T extends Component>(child: T): T;
  /** 摘除并卸载一个子组件。 */
  removeChild<T extends Component>(child: T): T;
  /** 登记一个卸载时执行的清理回调。 */
  register(cleanup: () => void): void;
  /** 登记一个 DOM 监听，卸载时自动 removeEventListener。 */
  registerDomEvent<K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    callback: (ev: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  /** 登记一个 setInterval 句柄，卸载时自动 clearInterval。返回原句柄。 */
  registerInterval(id: number): number;
}
