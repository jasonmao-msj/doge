import { installRendererLifecycleDiagnostics } from "./services/rendererDiagnostics";
import { migrateLocalStorageToFileStore } from "./services/migrateLocalStorage";
import {
  isReactScanStartupEnabled,
  startReactScanOverlay,
} from "./services/reactScanController";
import { installRendererPlatformAttribute } from "./utils/rendererPlatform";

installRendererPlatformAttribute();
installRendererLifecycleDiagnostics();
// Migrate brand-prefixed keys before bootstrapApp imports modules that read
// localStorage at module initialization. The later bootstrap migration remains
// as an idempotent, observable safety pass.
try {
  migrateLocalStorageToFileStore();
} catch (error) {
  console.warn("[doge] early local storage migration failed", error);
}

// react-scan 必须在 React 首次 import 之前完成 instrumentation，否则生产版
// 会报 "Must import React Scan before React runs" 且 topRenders 恒空。
// bootstrapApp 顶层静态 import React，因此这里只能动态 import startApp。
async function boot() {
  if (isReactScanStartupEnabled()) {
    await startReactScanOverlay();
  }
  const { startApp } = await import("./bootstrapApp");
  await startApp();
}

void boot();
