import { expect, test } from "./fixtures.mjs";

test("test_webrepl_connection_uses_input_dialog", async ({ page, consoleErrors }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.locator("#btn-conn-ws").click();
  await expect(page.locator("#user-input-dialog")).toBeVisible();
  await expect(page.locator("#user-input-dialog-title")).toHaveText("Connect WebREPL");
  await expect(page.locator("#user-input-value")).toHaveValue("ws://192.168.1.123:8266");
  await page.keyboard.press("Escape");

  await expect(page.locator("#user-input-dialog")).not.toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("test_create_file_uses_input_dialog", async ({ page, consoleErrors }) => {
  await page.goto("/?vm=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#btn-conn-ws")).toHaveClass(/connected/);

  const createFile = page.evaluate(() => globalThis.app.createNewFile("/"));
  await expect(page.locator("#user-input-dialog-title")).toHaveText("Create inside /");
  await page.locator("#user-input-value").fill("dialog-created.py");
  await page.locator("#user-input-confirm").click();
  await createFile;

  await expect(page.locator('#editor-tabs .tab[data-fn="/dialog-created.py"]')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

for (const pageName of ["benchmark.html", "bridge.html"]) {
  test(`test_${pageName}_webrepl_uses_input_dialog`, async ({ page, consoleErrors }) => {
    await page.goto(`/${pageName}`, { waitUntil: "domcontentloaded" });

    await page.locator("#btn-conn-ws").click();
    await expect(page.locator("#user-input-dialog")).toBeVisible();
    await expect(page.locator("#user-input-dialog-title")).toHaveText("Connect WebREPL");
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.locator("#user-input-dialog")).not.toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
}