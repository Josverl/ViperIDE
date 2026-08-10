import re

from playwright.sync_api import expect


def test_diagnostics_panel_filters_jumps_and_run_returns_to_terminal(page, viperide_server, tmp_path):
    console_errors = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text) if message.type == "error" else None,
    )
    page.on("dialog", lambda dialog: dialog.dismiss())
    page.goto(f"{viperide_server}/?vm=1", wait_until="domcontentloaded")

    typecheck_tab = page.locator('[data-target="diagnostics"]')
    terminal_tab = page.locator('[data-target="xterm"]')
    editor = page.locator(".cm-content")
    diagnostics = page.locator("#diagnostics")
    rows = page.locator("#diagnostics-list .diagnostic-item")

    expect(typecheck_tab).to_have_attribute("data-state", "ready", timeout=90_000)
    expect(page.locator("#typechecking-status")).to_have_count(0)
    expect(typecheck_tab.locator("svg[data-icon=square-check]")).to_have_count(1)
    expect(page.locator("#tab-problems")).to_have_text("Problems")

    editor.fill("import missing_module\n\nprint(undefined_name)\n")
    typecheck_tab.click()
    expect(diagnostics).to_have_class(re.compile(r"\bactive\b"))
    expect(rows.first).to_be_visible(timeout=30_000)
    expect(page.locator("#diagnostics-file")).to_contain_text("main.py")
    controls = page.locator("#diagnostics-controls")
    expect(controls).to_have_css("font-size", "11.2px")
    assert controls.evaluate("element => element.getBoundingClientRect().height") < 32

    page.locator('#diagnostics-severities input[value="error"]').uncheck()
    page.locator('#diagnostics-severities input[value="info"]').uncheck()
    expect(rows.first).to_be_visible()
    assert page.locator("#diagnostics-list .diagnostic-item").evaluate_all(
        "(items) => items.every((item) => item.dataset.severity === 'warning')"
    )
    page.locator("#diagnostics-file").select_option("/main.py")

    first = rows.first
    expected_line = first.get_attribute("data-line")
    first.click()
    expect(page.locator("#editor-tabs .tab.active")).to_have_attribute("data-fn", "/main.py")
    expect(page.locator(".cm-activeLine")).to_be_visible()
    assert expected_line is not None
    assert page.locator(".cm-activeLine").inner_text() == editor.inner_text().splitlines()[int(expected_line) - 1]

    page.screenshot(path=tmp_path / "diagnostics-panel.png")

    page.locator("#btn-run").click()
    expect(terminal_tab).to_have_class(re.compile(r"\bactive\b"))
    expect(page.locator("#xterm")).to_have_class(re.compile(r"\bactive\b"))
    expect(page.locator(".xterm-helper-textarea")).to_be_focused()
    assert console_errors == []


def test_pyright_diagnostics_are_merged_with_host_linters(page, viperide_server, tmp_path):
    page.on("dialog", lambda dialog: dialog.dismiss())
    page.add_init_script(
        """
        localStorage.setItem('settings', JSON.stringify({
            'typecheck-enabled': true,
            'typecheck-scope': 'openFilesOnly'
        }));
        """
    )
    page.goto(f"{viperide_server}/?vm=1", wait_until="domcontentloaded")

    typecheck_tab = page.locator("#typecheck-tab")
    expect(typecheck_tab).to_have_attribute(
        "title", re.compile(r"standard mode with webassembly stubs"), timeout=90_000
    )

    page.locator(".cm-content").fill(
        "from typing_extensions import reveal_type\n"
        "\n"
        "import rp2\n"
        "import idonotexist\n"
        "import micropython\n"
        "\n"
        "reveal_type(idonotexist)\n"
    )
    page.locator('[data-target="diagnostics"]').click()

    pyright_rows = page.locator(".diagnostic-item").filter(has=page.locator(".diagnostic-source", has_text="Pyright"))
    expect(pyright_rows).to_have_count(5, timeout=30_000)
    ruff_rows = page.locator(".diagnostic-item").filter(has=page.locator(".diagnostic-source", has_text="Ruff"))
    expect(ruff_rows).to_have_count(2)

    results = pyright_rows.evaluate_all(
        """rows => rows.map(row => ({
            severity: row.dataset.severity,
            message: row.querySelector('.diagnostic-message').textContent,
            source: row.querySelector('.diagnostic-source').textContent,
        }))"""
    )
    assert [result["severity"] for result in results].count("error") == 2
    assert [result["severity"] for result in results].count("warning") == 2
    assert [result["severity"] for result in results].count("info") == 1
    badge = page.locator("#diagnostics-badge")
    expect(badge).to_have_attribute("data-severity", "error")
    expect(badge).to_have_css("background-color", "rgb(255, 136, 119)")
    assert any('Import "rp2" could not be resolved' in result["message"] for result in results)
    assert any('Import "idonotexist" could not be resolved' in result["message"] for result in results)
    assert any('Type of "idonotexist" is "Module("idonotexist")"' in result["message"] for result in results)
    expect(page.locator(".cm-lintRange-error")).to_have_count(2)
    expect(page.locator(".cm-lintRange-info")).to_have_count(1)
    expect(page.locator(".cm-lintPoint-error")).to_have_count(0)
    expect(page.locator(".cm-lintPoint-info")).to_have_count(0)
    layout = page.locator("#diagnostics").evaluate(
        """panel => {
            const row = panel.querySelector('.diagnostic-item');
            const severity = row.querySelector('.diagnostic-severity');
            const location = row.querySelector('.diagnostic-location');
            return {
                clientWidth: panel.clientWidth,
                scrollWidth: panel.scrollWidth,
                overflowX: getComputedStyle(panel).overflowX,
                severityWidth: severity.getBoundingClientRect().width,
                warningWidth: (() => {
                    const probe = severity.cloneNode();
                    probe.textContent = 'Warning';
                    probe.style.position = 'fixed';
                    probe.style.visibility = 'hidden';
                    probe.style.width = 'max-content';
                    document.body.append(probe);
                    const width = probe.getBoundingClientRect().width;
                    probe.remove();
                    return width;
                })(),
                locationWidth: location.getBoundingClientRect().width,
                locationWhiteSpace: getComputedStyle(location).whiteSpace,
                locationTextOverflow: getComputedStyle(location).textOverflow,
            };
        }"""
    )
    assert layout["scrollWidth"] <= layout["clientWidth"]
    assert layout["overflowX"] == "auto"
    assert layout["severityWidth"] >= layout["warningWidth"]
    assert layout["severityWidth"] - layout["warningWidth"] < 8
    assert abs(layout["locationWidth"] - 180) < 1
    assert layout["locationWhiteSpace"] == "normal"
    assert layout["locationTextOverflow"] == "clip"

    page.locator(".cm-content").fill("import micropython\n")
    expect(badge).to_have_attribute("data-severity", "warning", timeout=30_000)
    expect(badge).to_have_css("background-color", "rgb(255, 238, 136)")

    page.locator(".cm-content").fill("from typing_extensions import reveal_type\nvalue = 1\nreveal_type(value)\n")
    expect(badge).to_have_attribute("data-severity", "info", timeout=30_000)
    expect(badge).to_have_css("background-color", "rgb(170, 170, 255)")
    page.screenshot(path=tmp_path / "diagnostics-panel-pyright.png")


def test_typechecking_scope_includes_unopened_files_and_opens_them_from_diagnostics(page, viperide_server, tmp_path):
    console_errors = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text) if message.type == "error" else None,
    )
    page.add_init_script(
        """
        localStorage.setItem('settings', JSON.stringify({
            'typecheck-enabled': true,
            'typecheck-scope': 'workspace'
        }));
        """
    )
    page.goto(f"{viperide_server}/?vm=1", wait_until="domcontentloaded")

    status = page.locator("#typecheck-tab")
    expect(status).to_have_attribute("data-state", "ready", timeout=90_000)

    page.once("dialog", lambda dialog: dialog.accept("scope_unopened.py"))
    page.evaluate("app.createNewFile('/')")
    expect(page.locator("#editor-tabs .tab.active")).to_have_attribute("data-fn", "/scope_unopened.py")
    page.locator(".editor-tab-pane.active .cm-content").fill('workspace_value: int = "wrong"\n')
    page.evaluate("app.saveCurrentFile()")
    page.locator('#editor-tabs .tab[data-fn="/scope_unopened.py"] .menu-action').click()
    expect(page.locator('#editor-tabs .tab[data-fn="/scope_unopened.py"]')).to_have_count(0)

    page.locator('[data-target="diagnostics"]').click()
    unopened_rows = page.locator('#diagnostics-list .diagnostic-item[data-path="/scope_unopened.py"]')
    expect(unopened_rows).to_have_count(1, timeout=30_000)
    expect(unopened_rows.first).to_contain_text("not assignable")
    page.screenshot(path=tmp_path / "diagnostics-unopened-workspace-file.png")

    page.locator('[data-target="menu-settings"]').click()
    scope = page.locator("#typecheck-scope")
    scope.select_option("openFilesOnly")
    expect(status).to_have_attribute("data-state", "ready", timeout=90_000)
    expect(unopened_rows).to_have_count(0, timeout=30_000)

    scope.select_option("workspace")
    expect(status).to_have_attribute("data-state", "ready", timeout=90_000)
    page.locator('[data-target="diagnostics"]').click()
    expect(unopened_rows).to_have_count(1, timeout=30_000)

    unopened_rows.first.click()
    expect(page.locator("#editor-tabs .tab.active")).to_have_attribute("data-fn", "/scope_unopened.py")
    expect(page.locator(".editor-tab-pane.active .cm-activeLine")).to_contain_text("workspace_value")
    assert console_errors == []
