import re

from playwright.sync_api import expect


def test_diagnostics_panel_filters_jumps_and_run_returns_to_terminal(
    page, viperide_server, tmp_path
):
    console_errors = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("dialog", lambda dialog: dialog.dismiss())
    page.goto(f"{viperide_server}/?vm=1", wait_until="domcontentloaded")

    typecheck_tab = page.locator('[data-target="diagnostics"]')
    terminal_tab = page.locator('[data-target="xterm"]')
    editor = page.locator(".cm-content")
    diagnostics = page.locator("#diagnostics")
    rows = page.locator("#diagnostics-list .diagnostic-item")

    expect(page.locator("#typechecking-status")).to_have_text(
        "Type check: Ready", timeout=90_000
    )
    expect(typecheck_tab.locator("svg[data-icon=square-check]")).to_have_count(1)

    editor.fill("import missing_module\n\nprint(undefined_name)\n")
    typecheck_tab.click()
    expect(diagnostics).to_have_class(re.compile(r"\bactive\b"))
    expect(rows.first).to_be_visible(timeout=30_000)
    expect(page.locator("#diagnostics-file")).to_contain_text("main.py")

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
    expect(page.locator('#editor-tabs .tab.active')).to_have_attribute(
        "data-fn", "/main.py"
    )
    expect(page.locator(".cm-activeLine")).to_be_visible()
    assert expected_line is not None
    assert page.locator(".cm-activeLine").inner_text() == editor.inner_text().splitlines()[
        int(expected_line) - 1
    ]

    page.screenshot(path=tmp_path / "diagnostics-panel.png")

    page.locator("#btn-run").click()
    expect(terminal_tab).to_have_class(re.compile(r"\bactive\b"))
    expect(page.locator("#xterm")).to_have_class(re.compile(r"\bactive\b"))
    expect(page.locator(".xterm-helper-textarea")).to_be_focused()
    assert console_errors == []


def test_pyright_diagnostics_are_merged_with_host_linters(
    page, viperide_server, tmp_path
):
    page.on("dialog", lambda dialog: dialog.dismiss())
    page.goto(f"{viperide_server}/?vm=1", wait_until="domcontentloaded")

    status = page.locator("#typechecking-status")
    expect(status).to_have_attribute(
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

    pyright_rows = page.locator(".diagnostic-item").filter(
        has=page.locator(".diagnostic-source", has_text="Pyright")
    )
    expect(pyright_rows).to_have_count(5, timeout=30_000)

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
    assert any('Import "rp2" could not be resolved' in result["message"] for result in results)
    assert any(
        'Import "idonotexist" could not be resolved' in result["message"]
        for result in results
    )
    assert any(
        'Type of "idonotexist" is "Module("idonotexist")"' in result["message"]
        for result in results
    )
    expect(page.locator(".cm-lintRange-error")).to_have_count(2)
    expect(page.locator(".cm-lintRange-info")).to_have_count(1)
    expect(page.locator(".cm-lintPoint-error")).to_have_count(0)
    expect(page.locator(".cm-lintPoint-info")).to_have_count(0)
    page.screenshot(path=tmp_path / "diagnostics-panel-pyright.png")
