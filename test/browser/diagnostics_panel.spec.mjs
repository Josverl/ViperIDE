import { expect, test } from "./fixtures.mjs";
import { configureTypechecking, pyrightRows } from "./helpers.mjs";

// Ensures mpy-cross syntax failures identify the exception class users need to diagnose the error.
test("test_mpy_cross_diagnostic_includes_exception_class", async ({ page }, testInfo) => {
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.goto("/?vm=1", { waitUntil: "domcontentloaded" });

  await page.locator(".cm-content").fill("1a\n");
  await page.locator('[data-target="diagnostics"]').click();

  const diagnostic = page
    .locator(".diagnostic-item")
    .filter({ has: page.locator(".diagnostic-source", { hasText: "mpy-cross" }) });
  await expect(diagnostic).toBeVisible({ timeout: 30_000 });
  await expect(diagnostic.locator(".diagnostic-message")).toHaveText(
    "SyntaxError: invalid syntax for integer with base 10: '1a'",
  );

  const screenshotPath = testInfo.outputPath("mpy-cross-syntax-error.png");
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach("mpy-cross-syntax-error.png", { path: screenshotPath, contentType: "image/png" });
});

// Covers the complete Problems-panel workflow: filtering, source navigation, and returning to the terminal.
test(
  "test_diagnostics_panel_filters_jumps_and_run_returns_to_terminal",
  async ({ page, consoleErrors }, testInfo) => {
    page.on("dialog", (dialog) => dialog.dismiss());
    await page.goto("/?vm=1", { waitUntil: "domcontentloaded" });

    const typecheckTab = page.locator('[data-target="diagnostics"]');
    const terminalTab = page.locator('[data-target="xterm"]');
    const editor = page.locator(".cm-content");
    const diagnostics = page.locator("#diagnostics");
    const rows = page.locator("#diagnostics-list .diagnostic-item");

    await expect(typecheckTab).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
    await expect(page.locator("#typechecking-status")).toHaveCount(0);
    await expect(typecheckTab.locator("svg[data-icon=square-check]")).toHaveCount(1);
    await expect(page.locator("#tab-problems")).toHaveText("Problems");
    await expect(typecheckTab).toHaveAttribute("aria-label", /^Problems: Pyright is /);
    await expect(diagnostics).toHaveAttribute("aria-label", "Problems");

    await editor.fill("import missing_module\n\nprint(undefined_name)\n");
    await typecheckTab.click();
    await expect(diagnostics).toHaveClass(/\bactive\b/);
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#diagnostics-file")).toContainText("main.py");
    const controls = page.locator("#diagnostics-controls");
    await expect(controls).toHaveCSS("font-size", "11.2px");
    expect(await controls.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(32);

    await page.locator('#diagnostics-severities input[value="error"]').uncheck();
    await page.locator('#diagnostics-severities input[value="info"]').uncheck();
    await expect(rows.first()).toBeVisible();
    expect(
      await page.locator("#diagnostics-list .diagnostic-item").evaluateAll((items) =>
        items.every((item) => item.dataset.severity === "warning"),
      ),
    ).toBe(true);
    await page.locator("#diagnostics-file").selectOption("/main.py");

    const first = rows.first();
    const expectedLine = await first.getAttribute("data-line");
    await first.click();
    await expect(page.locator("#editor-tabs .tab.active")).toHaveAttribute("data-fn", "/main.py");
    await expect(page.locator(".cm-activeLine")).toBeVisible();
    expect(expectedLine).not.toBeNull();
    expect(await page.locator(".cm-activeLine").innerText()).toBe(
      (await editor.innerText()).split("\n")[Number(expectedLine) - 1],
    );

    const screenshotPath = testInfo.outputPath("diagnostics-panel.png");
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("diagnostics-panel.png", { path: screenshotPath, contentType: "image/png" });

    await page.locator("#btn-run").click();
    await expect(terminalTab).toHaveClass(/\bactive\b/);
    await expect(page.locator("#xterm")).toHaveClass(/\bactive\b/);
    await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
    expect(consoleErrors).toEqual([]);
  },
);

// Ensures Pyright diagnostics coexist with host linters and drive the editor and badge severity states.
test("test_pyright_diagnostics_are_merged_with_host_linters", async ({ page }, testInfo) => {
  page.on("dialog", (dialog) => dialog.dismiss());
  await configureTypechecking(page, { "typecheck-scope": "openFilesOnly" });
  await page.goto("/?vm=1", { waitUntil: "domcontentloaded" });

  const typecheckTab = page.locator("#typecheck-tab");
  await expect(typecheckTab).toHaveAttribute("title", /standard mode with esp32 stubs/, {
    timeout: 90_000,
  });

  await page.locator(".cm-content").fill(
    "from typing_extensions import reveal_type\n\n" +
      "import rp2\n" +
      "import idonotexist\n" +
      "import micropython\n\n" +
      "reveal_type(idonotexist)\n",
  );
  await page.locator('[data-target="diagnostics"]').click();

  const pyrightDiagnosticRows = pyrightRows(page, "/main.py");
  await expect(pyrightDiagnosticRows).toHaveCount(5, { timeout: 30_000 });
  const ruffRows = page
    .locator(".diagnostic-item")
    .filter({ has: page.locator(".diagnostic-source", { hasText: "Ruff" }) });
  await expect(ruffRows).toHaveCount(2);

  const results = await pyrightDiagnosticRows.evaluateAll((rows) =>
    rows.map((row) => ({
      severity: row.dataset.severity,
      message: row.querySelector(".diagnostic-message").textContent,
      source: row.querySelector(".diagnostic-source").textContent,
    })),
  );
  expect(results.filter((result) => result.severity === "error")).toHaveLength(2);
  expect(results.filter((result) => result.severity === "warning")).toHaveLength(2);
  expect(results.filter((result) => result.severity === "info")).toHaveLength(1);
  const badge = page.locator("#diagnostics-badge");
  await expect(badge).toHaveAttribute("data-severity", "error");
  await expect(badge).toHaveCSS("background-color", "rgb(255, 136, 119)");
  expect(results.some((result) => result.message.includes('Import "rp2" could not be resolved'))).toBe(true);
  expect(results.some((result) => result.message.includes('Import "idonotexist" could not be resolved'))).toBe(
    true,
  );
  expect(
    results.some((result) => result.message.includes('Type of "idonotexist" is "Module("idonotexist")"')),
  ).toBe(true);
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(2);
  await expect(page.locator(".cm-lintRange-info")).toHaveCount(1);
  await expect(page.locator(".cm-lintPoint-error")).toHaveCount(0);
  await expect(page.locator(".cm-lintPoint-info")).toHaveCount(0);

  await page.locator(".cm-content").fill("import micropython\n");
  await expect(badge).toHaveAttribute("data-severity", "warning", { timeout: 30_000 });
  await expect(badge).toHaveCSS("background-color", "rgb(255, 238, 136)");
  await expect(
    page.locator('.diagnostic-item:has-text("micropython")'),
  ).toHaveCount(2);

  await page
    .locator(".cm-content")
    .fill("from typing_extensions import reveal_type\nvalue = 1\nreveal_type(value)\n");
  await expect(badge).toHaveAttribute("data-severity", "info", { timeout: 30_000 });
  await expect(badge).toHaveCSS("background-color", "rgb(170, 170, 255)");

  const screenshotPath = testInfo.outputPath("diagnostics-panel-pyright.png");
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach("diagnostics-panel-pyright.png", { path: screenshotPath, contentType: "image/png" });
});

// Verifies workspace scope reports closed files and diagnostics can reopen them at the failing line.
test(
  "test_typechecking_scope_includes_unopened_files_and_opens_them_from_diagnostics",
  async ({ page, consoleErrors }, testInfo) => {
    await configureTypechecking(page, { "typecheck-scope": "workspace" });
    await page.goto("/?vm=1", { waitUntil: "domcontentloaded" });

    const status = page.locator("#typecheck-tab");
    await expect(status).toHaveAttribute("data-state", "ready", { timeout: 90_000 });

    const createFile = page.evaluate(() => globalThis.app.createNewFile("/"));
    await page.locator("#user-input-value").fill("scope_unopened.py");
    await page.locator("#user-input-confirm").click();
    await createFile;
    await expect(page.locator("#editor-tabs .tab.active")).toHaveAttribute(
      "data-fn",
      "/scope_unopened.py",
    );
    await page.locator(".editor-tab-pane.active .cm-content").fill('workspace_value: int = "wrong"\n');
    await page.evaluate(() => globalThis.app.saveCurrentFile());
    await page.locator('#editor-tabs .tab[data-fn="/scope_unopened.py"] .menu-action').click();
    await expect(page.locator('#editor-tabs .tab[data-fn="/scope_unopened.py"]')).toHaveCount(0);

    await page.locator('[data-target="diagnostics"]').click();
    const unopenedRows = page.locator(
      '#diagnostics-list .diagnostic-item[data-path="/scope_unopened.py"]',
    );
    await expect(unopenedRows).toHaveCount(1, { timeout: 30_000 });
    await expect(unopenedRows.first()).toContainText("not assignable");

    const screenshotPath = testInfo.outputPath("diagnostics-unopened-workspace-file.png");
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("diagnostics-unopened-workspace-file.png", {
      path: screenshotPath,
      contentType: "image/png",
    });

    await page.locator('[data-target="menu-settings"]').click();
    const scope = page.locator("#typecheck-scope");
    await scope.selectOption("openFilesOnly");
    await expect(status).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
    await expect(unopenedRows).toHaveCount(0, { timeout: 30_000 });

    await scope.selectOption("workspace");
    await expect(status).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
    await page.locator('[data-target="diagnostics"]').click();
    await expect(unopenedRows).toHaveCount(1, { timeout: 30_000 });

    await unopenedRows.first().click();
    await expect(page.locator("#editor-tabs .tab.active")).toHaveAttribute(
      "data-fn",
      "/scope_unopened.py",
    );
    await expect(page.locator(".editor-tab-pane.active .cm-activeLine")).toContainText("workspace_value");
    expect(consoleErrors).toEqual([]);
  },
);