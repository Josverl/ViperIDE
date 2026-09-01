import { expect, test } from "./fixtures.mjs";
import { configureTypechecking, defaultCatalogVersion } from "./helpers.mjs";

// Verifies VM detection selects matching WebAssembly stubs while still allowing a manual override.
test("test_typechecking_autodetects_connected_vm", async ({ page, consoleErrors }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("settings", JSON.stringify({ "typecheck-enabled": true }));
  });
  await page.goto("/?vm=1", { waitUntil: "domcontentloaded" });

  const status = page.locator("#typecheck-tab");
  const settingsTab = page.locator('[data-target="menu-settings"]');
  const autodetect = page.locator("#typecheck-autodetect");
  const family = page.locator("#typecheck-stub-family");
  const version = page.locator("#typecheck-stub-version");
  const port = page.locator("#typecheck-stub-port");
  const board = page.locator("#typecheck-stub-board");
  const packageInput = page.locator("#typecheck-stub-selected-package");

  await expect(status).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  await expect(status).toHaveAttribute("title", /standard mode with webassembly stubs/, {
    timeout: 90_000,
  });
  await settingsTab.click();
  await expect(autodetect).toBeChecked();
  await expect(page.locator("label[for=typecheck-autodetect]")).toHaveText("Autoselect stubs");
  await expect(family).toHaveValue("micropython");
  await expect(port).toHaveValue("webassembly");
  await expect(board).toHaveValue("PYSCRIPT");
  await expect(packageInput).toHaveValue(/^micropython-webassembly-stubs==/);
  for (const selector of [family, version, port, board]) {
    await expect(selector).toBeDisabled();
  }
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("settings"))["typecheck-autodetect"]),
  ).toBe(true);

  await autodetect.uncheck();
  for (const selector of [family, version, port, board]) {
    await expect(selector).toBeEnabled();
  }
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("settings"))["typecheck-autodetect"]),
  ).toBe(false);
  expect(consoleErrors).toEqual([]);

  const screenshotPath = testInfo.outputPath("typechecking-autodetect-vm.png");
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach("typechecking-autodetect-vm.png", { path: screenshotPath, contentType: "image/png" });
});

// Guards against deadlocks when switching between ports that are available only through the catalog.
test("test_catalog_only_stub_port_can_switch_without_deadlock", async ({ page, consoleErrors }, testInfo) => {
  await configureTypechecking(page);
  await page.goto("/?vm=1", { waitUntil: "domcontentloaded" });
  const status = page.locator("#typecheck-tab");
  const port = page.locator("#typecheck-stub-port");
  const packageInput = page.locator("#typecheck-stub-selected-package");

  await expect(status).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  await page.locator('[data-target="menu-settings"]').click();
  await port.selectOption("esp8266");
  await expect(status).toHaveAttribute("title", /standard mode with esp8266 stubs/, {
    timeout: 90_000,
  });
  await expect(packageInput).toHaveValue(/^micropython-esp8266/, { timeout: 90_000 });

  await port.selectOption("esp32");
  await expect(status).toHaveAttribute("title", /standard mode with esp32 stubs/, {
    timeout: 90_000,
  });
  await expect(packageInput).toHaveValue(/^micropython-esp32-stubs==/, { timeout: 90_000 });
  await expect(port).toBeEnabled();
  expect(consoleErrors).toEqual([]);

  const screenshotPath = testInfo.outputPath("typechecking-catalog-port-switch.png");
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach("typechecking-catalog-port-switch.png", {
    path: screenshotPath,
    contentType: "image/png",
  });
});

// Verifies mode, scope, and board choices persist across reloads and continue to reanalyze the editor.
test("test_typechecking_mode_and_stub_selection_persist", async ({ page, consoleErrors }, testInfo) => {
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("typechecking-settings-test")) {
      localStorage.setItem(
        "settings",
        JSON.stringify({
          "typecheck-enabled": true,
          "typecheck-autodetect": false,
        }),
      );
      sessionStorage.setItem("typechecking-settings-test", "initialized");
    }
  });
  await page.goto("/?vm=1", { waitUntil: "domcontentloaded" });

  const status = page.locator("#typecheck-tab");
  const mode = page.locator("#typecheck-mode");
  const scope = page.locator("#typecheck-scope");
  const autodetect = page.locator("#typecheck-autodetect");
  const family = page.locator("#typecheck-stub-family");
  const version = page.locator("#typecheck-stub-version");
  const port = page.locator("#typecheck-stub-port");
  const board = page.locator("#typecheck-stub-board");
  const packageInput = page.locator("#typecheck-stub-selected-package");
  const packageRow = page.locator(".typecheck-package-info");
  const advancedMode = page.locator("#advanced-mode");
  const editor = page.locator(".cm-content");
  const settingsTab = page.locator('[data-target="menu-settings"]');

  await expect(status).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  await expect(status).toHaveAttribute("title", /standard mode with esp32 stubs/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("settings"))["typecheck-mode"])).toBe(
    "standard",
  );
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("settings"))["typecheck-scope"])).toBe(
    "openFilesOnly",
  );

  await settingsTab.click();
  await expect(mode).toHaveValue("standard");
  await expect(scope).toHaveValue("openFilesOnly");
  await expect(autodetect).not.toBeChecked();
  await expect(scope.locator("option[value=workspace]")).toHaveText("All");
  await expect(scope.locator("option[value=openFilesOnly]")).toHaveText("Opened");
  await expect(family).toHaveValue("micropython");
  const catalogVersion = await defaultCatalogVersion(page);
  await expect(version).toHaveValue(catalogVersion);
  await expect(port).toHaveValue("esp32");
  await expect(board).toHaveValue("GENERIC");
  await expect(packageInput).toHaveValue(
    new RegExp(`^micropython-esp32-stubs==${catalogVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
  await expect(packageRow).toBeHidden();
  await advancedMode.check();
  await expect(packageRow).toBeVisible();
  await advancedMode.uncheck();
  await expect(packageRow).toBeHidden();
  expect(
    await page.locator("#menu-line-other").evaluate(
      (other) =>
        Boolean(
          other.compareDocumentPosition(document.querySelector("#menu-line-typechecking")) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
    ),
  ).toBe(true);
  await expect(page.locator("#menu-line-typechecking")).toHaveText("Typechecking");
  await expect(page.locator("#typecheck-stub-package-help")).toHaveCount(0);
  await expect(page.locator("label[for=typecheck-stub-family]")).toHaveText("Family");
  await expect(page.locator("label[for=typecheck-stub-version]")).toHaveText("Version");
  await expect(page.locator("label[for=typecheck-stub-port]")).toHaveText("Port");
  await expect(page.locator("label[for=typecheck-stub-board]")).toHaveText("Board");
  await expect(page.locator("label[for=typecheck-stub-selected-package]")).toHaveText("Package");
  for (const dropdown of [mode, scope, family, version, port, board]) {
    expect(await dropdown.evaluate((element) => getComputedStyle(element).textAlign)).toBe("right");
  }
  for (const buttonId of ["#typecheck-stub-install", "#typecheck-stub-clear"]) {
    const buttonStyle = await page.locator(buttonId).evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderStyle: style.borderStyle,
        borderWidth: style.borderWidth,
        fontSize: Number.parseFloat(style.fontSize),
      };
    });
    expect(buttonStyle.borderStyle).toBe("solid");
    expect(buttonStyle.borderWidth).toBe("1px");
    expect(buttonStyle.fontSize).toBeLessThan(14);
  }
  await mode.selectOption("strict");
  await expect(status).toHaveAttribute("title", /strict mode with esp32 stubs/, { timeout: 90_000 });

  await port.selectOption("rp2");
  await expect(status).toHaveAttribute("title", /strict mode with rp2 stubs/, { timeout: 90_000 });
  await board.selectOption("RPI_PICO_W");
  await expect(packageInput).toHaveValue(/^micropython-rp2-rpi-pico-w-stubs==/, { timeout: 90_000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("settings"))["typecheck-mode"])).toBe(
    "strict",
  );
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("settings"))["typecheck-stub-port"]),
  ).toBe("rp2");
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("settings"))["typecheck-stub-board"]),
  ).toBe("RPI_PICO_W");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(status).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  await expect(status).toHaveAttribute("title", /strict mode with rp2 stubs/);
  await expect(mode).toHaveValue("strict");
  await expect(scope).toHaveValue("openFilesOnly");
  await expect(port).toHaveValue("rp2");
  await expect(board).toHaveValue("RPI_PICO_W");
  await expect(packageInput).toHaveValue(/^micropython-rp2-rpi-pico-w-stubs==/);

  await editor.fill("def identity(value):\n    return value\n");
  await expect(page.locator("#diagnostics-badge")).not.toBeEmpty({ timeout: 30_000 });

  await settingsTab.click();
  await mode.selectOption("basic");
  await expect(status).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  await expect(status).toHaveAttribute("title", /basic mode with rp2 stubs/);
  await expect(editor).toContainText("def identity(value):");
  expect(consoleErrors).toEqual([]);

  const screenshotPath = testInfo.outputPath("typechecking-settings-basic-rp2.png");
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach("typechecking-settings-basic-rp2.png", {
    path: screenshotPath,
    contentType: "image/png",
  });
});

// Covers installing, restoring, clearing, and disabling additional cached stub packages.
test("test_typechecking_stub_packages_install_and_persist", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings",
      JSON.stringify({
        "typecheck-enabled": true,
        "advanced-mode": true,
      }),
    );
  });
  await page.goto("/?vm=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#typecheck-tab")).toHaveAttribute("data-state", "ready", {
    timeout: 90_000,
  });
  await page.locator('[data-target="menu-settings"]').click();

  const packageInput = page.locator("#typecheck-stub-package");
  await packageInput.fill("types-requests");
  await packageInput.press("Enter");
  await expect(page.locator("#typecheck-stub-status")).toContainText("Installed types-requests@", {
    timeout: 90_000,
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#typecheck-tab")).toHaveAttribute("data-state", "ready", {
    timeout: 90_000,
  });
  await page.locator('[data-target="menu-settings"]').click();
  await expect(page.locator("#typecheck-stub-status")).toContainText("types-requests@", {
    timeout: 90_000,
  });

  const screenshotPath = testInfo.outputPath("typechecking-persistent-stub-package.png");
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach("typechecking-persistent-stub-package.png", {
    path: screenshotPath,
    contentType: "image/png",
  });

  await page.locator("#typecheck-stub-clear").click();
  await expect(page.locator("#typecheck-stub-status")).toHaveText("No cached stub packages.", {
    timeout: 90_000,
  });

  await page.locator("#typecheck-enabled").uncheck();
  await expect(page.locator("#typecheck-stub-package")).toBeDisabled();
  await expect(page.locator("#typecheck-stub-install")).toBeDisabled();
  await expect(page.locator("#typecheck-stub-clear")).toBeDisabled();
  await expect(page.locator("#typecheck-stub-status")).toHaveText(
    "Enable type checking to view or manage cached stub packages.",
  );
});