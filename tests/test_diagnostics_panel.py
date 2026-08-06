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
