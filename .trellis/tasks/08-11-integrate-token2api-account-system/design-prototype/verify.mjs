import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const prototypeDirectory = dirname(fileURLToPath(import.meta.url));
const screenshotDirectory = resolve(prototypeDirectory, "screenshots");
const prototypeUrl = process.env.DOGE_PROTOTYPE_URL ??
  "http://127.0.0.1:4178/.trellis/tasks/08-11-integrate-token2api-account-system/design-prototype/";

await mkdir(screenshotDirectory, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];

page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

const capture = async (name) => {
  await page.waitForTimeout(320);
  await page.screenshot({ path: resolve(screenshotDirectory, `${name}.png`), fullPage: true });
};

try {
  await page.goto(prototypeUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "欢迎使用 Doge" }).waitFor();
  await capture("01-login");

  await page.locator('form[data-form="auth"] .primary-button').click();
  await page.getByRole("heading", { name: "选择一个引擎" }).waitFor();
  await page.getByRole("button", { name: "查看引擎选择说明" }).hover();
  await capture("02-engine-tooltip");

  await page.getByRole("button", { name: "Codex" }).click();
  await page.getByRole("heading", { name: "选择 Codex 套餐" }).waitFor();
  await capture("03-plans");

  await page.getByRole("radio", { name: /高频/ }).click();
  await page.getByRole("button", { name: "订阅并继续" }).click();
  await page.getByRole("heading", { name: "请在浏览器完成支付" }).waitFor();
  await capture("04-payment-waiting");

  await page.getByRole("button", { name: "模拟支付完成" }).click();
  await page.getByRole("heading", { name: "Codex 已就绪" }).waitFor({ timeout: 7000 });
  await capture("05-codex-ready");

  await page.getByRole("button", { name: "重新体验" }).click();
  await page.locator('form[data-form="auth"] .primary-button').click();
  await page.getByRole("button", { name: "Claude Code" }).click();
  await page.getByRole("heading", { name: "Claude Code 已就绪" }).waitFor({ timeout: 7000 });
  await capture("06-claude-existing-entitlement");

  await page.getByRole("button", { name: "切换深浅色" }).click();
  await capture("07-dark-workspace");

  if (errors.length > 0) throw new Error(errors.join("\n"));
  console.log(`PASS: 7 screenshots written to ${screenshotDirectory}`);
} finally {
  await browser.close();
}
