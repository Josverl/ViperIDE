import re

from playwright.sync_api import expect


def test_typechecking_status_can_disable_and_restore_pyright(page, viperide_server, tmp_path):
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("dialog", lambda dialog: dialog.dismiss())

    page.goto(viperide_server, wait_until="domcontentloaded")

    status = page.locator("#typechecking-status")
    enabled = page.locator("#typecheck-enabled")
    editor_area = page.locator("#main-editor")
    expect(status).to_have_text(re.compile(r"Type check: Ready"), timeout=90_000)
    expect(status).to_have_attribute("data-state", "ready")
    expect(status).to_have_attribute("aria-pressed", "true")
    expect(editor_area).to_be_visible()

    status.click()

    expect(status).to_have_text("Type check: Off")
    expect(status).to_have_attribute("data-state", "disabled")
    expect(status).to_have_attribute("aria-pressed", "false")
    expect(enabled).not_to_be_checked()
    expect(editor_area).to_be_visible()
    assert page.evaluate("JSON.parse(localStorage.getItem('settings'))['typecheck-enabled']") is False

    status.click()

    expect(status).to_have_text(re.compile(r"Type check: Ready"), timeout=90_000)
    expect(status).to_have_attribute("data-state", "ready")
    expect(enabled).to_be_checked()
    expect(editor_area).to_be_visible()
    assert console_errors == []
    page.screenshot(path=tmp_path / "typechecking-status-ready.png")
