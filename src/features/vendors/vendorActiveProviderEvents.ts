/** 新建菜单启用供应商后，通知设置页刷新 isActive /「使用中」。 */
export const VENDOR_ACTIVE_PROVIDER_CHANGED_EVENT =
  "doge:vendor-active-provider-changed";

export type VendorActiveProviderChangedDetail = {
  engine: string;
  providerProfileId: string;
};

export function dispatchVendorActiveProviderChanged(
  detail: VendorActiveProviderChangedDetail,
): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(VENDOR_ACTIVE_PROVIDER_CHANGED_EVENT, { detail }),
  );
}
