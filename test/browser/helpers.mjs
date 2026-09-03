import { expect } from "@playwright/test";

const defaultTypecheckingSettings = {
  "typecheck-enabled": true,
  "typecheck-viper-tools-stubs": true,
  "typecheck-mode": "standard",
  "typecheck-scope": "workspace",
  "typecheck-autodetect": false,
  "typecheck-stub-family": "micropython",
  "typecheck-stub-version": "1.28.0",
  "typecheck-stub-port": "esp32",
  "typecheck-stub-board": "GENERIC",
};

export async function configureTypechecking(page, overrides = {}) {
  const settings = { ...defaultTypecheckingSettings, ...overrides };
  await page.addInitScript((value) => {
    localStorage.setItem("settings", JSON.stringify(value));
  }, settings);
}

export function collectConsoleErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
}

export function collectConsoleMessages(page) {
  const messages = [];
  page.on("console", (message) => {
    messages.push(message.text());
  });
  return messages;
}

export async function createPythonFile(page, filePath, content) {
  const workspacePath = filePath.startsWith("/") ? filePath : `/${filePath}`;
  const createFile = page.evaluate(() => globalThis.app.createNewFile("/"));
  await page.locator("#user-input-value").fill(filePath);
  await page.locator("#user-input-confirm").click();
  await createFile;
  await expect(page.locator("#editor-tabs .tab.active")).toHaveAttribute("data-fn", workspacePath);
  await page.locator(".editor-tab-pane.active .cm-content").fill(content);
}

export function pyrightRows(page, filePath) {
  return page
    .locator(`#diagnostics-list .diagnostic-item[data-path="${filePath}"]`)
    .filter({ has: page.locator(".diagnostic-source", { hasText: "Pyright" }) });
}

export async function expectVmTypecheckingReady(page, stubTarget = "esp32") {
  const status = page.locator("#typecheck-tab");
  await expect(status).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  await expect(status).toHaveAttribute("title", new RegExp(`standard mode with ${stubTarget} stubs`), {
    timeout: 90_000,
  });
  return status;
}

export async function defaultCatalogVersion(page) {
  return page.evaluate(async () => {
    const response = await fetch("assets/pyright-worker/assets/micropython-stub-package-catalog.json");
    return (await response.json()).defaultRuntimeVersion;
  });
}