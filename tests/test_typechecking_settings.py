import re

from playwright.sync_api import expect


def test_typechecking_mode_and_board_override_persist(page, viperide_server, tmp_path):
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("dialog", lambda dialog: dialog.dismiss())
    page.add_init_script(
        """
        if (!sessionStorage.getItem('typechecking-settings-test')) {
            localStorage.setItem('settings', JSON.stringify({'typecheck-enabled': true}));
            sessionStorage.setItem('typechecking-settings-test', 'initialized');
        }
        """
    )

    page.goto(f"{viperide_server}/?vm=1", wait_until="domcontentloaded")

    status = page.locator("#typechecking-status")
    mode = page.locator("#typecheck-mode")
    board = page.locator("#typecheck-stubs")
    editor = page.locator(".cm-content")
    settings_tab = page.locator('[data-target="menu-settings"]')

    expect(status).to_have_text("Type check: Ready", timeout=90_000)
    expect(status).to_have_attribute("title", re.compile(r"standard mode with webassembly stubs"))
    assert page.evaluate("JSON.parse(localStorage.getItem('settings'))['typecheck-mode']") == "standard"
    assert page.evaluate("JSON.parse(localStorage.getItem('settings'))['typecheck-stubs']") == "auto"

    settings_tab.click()
    expect(mode).to_have_value("standard")
    expect(board).to_have_value("auto")
    expect(board.locator("option[value=auto]")).to_have_text("Automatic")
    expect(board.locator("option")).to_have_count(7)
    expect(board.locator("option[value=stdlib]")).to_have_count(0)
    expect(board.locator("option[value=rp2]")).to_have_text("MP RP2 (v1.28.0)")
    mode.select_option("strict")
    expect(status).to_have_attribute("title", re.compile(r"strict mode with webassembly stubs"), timeout=90_000)

    board.select_option("rp2")
    expect(status).to_have_attribute("title", re.compile(r"strict mode with rp2 stubs"), timeout=90_000)
    assert page.evaluate("JSON.parse(localStorage.getItem('settings'))['typecheck-mode']") == "strict"
    assert page.evaluate("JSON.parse(localStorage.getItem('settings'))['typecheck-stubs']") == "rp2"

    page.reload(wait_until="domcontentloaded")
    expect(status).to_have_text("Type check: Ready", timeout=90_000)
    expect(status).to_have_attribute("title", re.compile(r"strict mode with rp2 stubs"))
    expect(mode).to_have_value("strict")
    expect(board).to_have_value("rp2")

    editor.fill("def identity(value):\n    return value\n")
    expect(status).to_have_text(re.compile(r"Type check: [1-9]\d* errors?"), timeout=30_000)

    settings_tab.click()
    mode.select_option("basic")
    expect(status).to_have_text("Type check: Ready", timeout=90_000)
    expect(status).to_have_attribute("title", re.compile(r"basic mode with rp2 stubs"))
    expect(editor).to_contain_text("def identity(value):")
    assert console_errors == []
    page.screenshot(path=tmp_path / "typechecking-settings-basic-rp2.png")
