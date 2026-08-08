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

    status = page.locator("#typecheck-tab")
    mode = page.locator("#typecheck-mode")
    scope = page.locator("#typecheck-scope")
    board = page.locator("#typecheck-stubs")
    editor = page.locator(".cm-content")
    settings_tab = page.locator('[data-target="menu-settings"]')

    expect(status).to_have_attribute("data-state", "ready", timeout=90_000)
    expect(status).to_have_attribute("title", re.compile(r"standard mode with webassembly stubs"))
    assert page.evaluate("JSON.parse(localStorage.getItem('settings'))['typecheck-mode']") == "standard"
    assert page.evaluate("JSON.parse(localStorage.getItem('settings'))['typecheck-scope']") == "workspace"
    assert page.evaluate("JSON.parse(localStorage.getItem('settings'))['typecheck-stubs']") == "auto"

    settings_tab.click()
    expect(mode).to_have_value("standard")
    expect(scope).to_have_value("workspace")
    expect(scope.locator("option[value=workspace]")).to_have_text("All")
    expect(scope.locator("option[value=openFilesOnly]")).to_have_text("Opened")
    expect(board).to_have_value("auto")
    expect(board.locator("option[value=auto]")).to_have_text("Automatic")
    expect(board.locator("option")).to_have_count(7)
    expect(board.locator("option[value=stdlib]")).to_have_count(0)
    expect(board.locator("option[value=rp2]")).to_have_text("MP RP2 (v1.28.0)")
    expect(board.locator("option[value=webassembly]")).to_have_text(
        "MP WebAssembly (v1.28.0)"
    )
    assert page.locator("#menu-line-other").evaluate(
        "(other) => Boolean(other.compareDocumentPosition("
        "document.querySelector('#menu-line-typechecking')) & Node.DOCUMENT_POSITION_FOLLOWING)"
    )
    expect(page.locator("#menu-line-typechecking")).to_have_text("Typechecking")
    expect(page.locator("#typecheck-stub-package-help")).to_have_count(0)
    for dropdown in (mode, scope, board):
        assert dropdown.evaluate("(element) => getComputedStyle(element).textAlign") == "right"
    for button_id in ("#typecheck-stub-install", "#typecheck-stub-clear"):
        button_style = page.locator(button_id).evaluate(
            """(element) => {
                const style = getComputedStyle(element);
                return {
                    borderStyle: style.borderStyle,
                    borderWidth: style.borderWidth,
                    fontSize: parseFloat(style.fontSize),
                };
            }"""
        )
        assert button_style["borderStyle"] == "solid"
        assert button_style["borderWidth"] == "1px"
        assert button_style["fontSize"] < 14
    mode.select_option("strict")
    expect(status).to_have_attribute("title", re.compile(r"strict mode with webassembly stubs"), timeout=90_000)

    board.select_option("rp2")
    expect(status).to_have_attribute("title", re.compile(r"strict mode with rp2 stubs"), timeout=90_000)
    assert page.evaluate("JSON.parse(localStorage.getItem('settings'))['typecheck-mode']") == "strict"
    assert page.evaluate("JSON.parse(localStorage.getItem('settings'))['typecheck-stubs']") == "rp2"
    scope.select_option("openFilesOnly")
    expect(status).to_have_attribute("data-state", "ready", timeout=90_000)
    assert (
        page.evaluate("JSON.parse(localStorage.getItem('settings'))['typecheck-scope']")
        == "openFilesOnly"
    )

    page.reload(wait_until="domcontentloaded")
    expect(status).to_have_attribute("data-state", "ready", timeout=90_000)
    expect(status).to_have_attribute("title", re.compile(r"strict mode with rp2 stubs"))
    expect(mode).to_have_value("strict")
    expect(scope).to_have_value("openFilesOnly")
    expect(board).to_have_value("rp2")

    editor.fill("def identity(value):\n    return value\n")
    expect(page.locator("#diagnostics-badge")).not_to_be_empty(timeout=30_000)

    settings_tab.click()
    mode.select_option("basic")
    expect(status).to_have_attribute("data-state", "ready", timeout=90_000)
    expect(status).to_have_attribute("title", re.compile(r"basic mode with rp2 stubs"))
    expect(editor).to_contain_text("def identity(value):")
    assert console_errors == []
    page.screenshot(path=tmp_path / "typechecking-settings-basic-rp2.png")


def test_typechecking_stub_packages_install_and_persist(page, viperide_server, tmp_path):
    page.add_init_script(
        """
        localStorage.setItem('settings', JSON.stringify({'typecheck-enabled': true}));
        """
    )
    page.goto(f"{viperide_server}/?vm=1", wait_until="domcontentloaded")
    expect(page.locator("#typecheck-tab")).to_have_attribute(
        "data-state", "ready", timeout=90_000
    )
    page.locator('[data-target="menu-settings"]').click()

    package_input = page.locator("#typecheck-stub-package")
    package_input.fill("types-requests")
    package_input.press("Enter")
    expect(page.locator("#typecheck-stub-status")).to_contain_text(
        "Installed types-requests@",
        timeout=90_000,
    )

    page.reload(wait_until="domcontentloaded")
    expect(page.locator("#typecheck-tab")).to_have_attribute(
        "data-state", "ready", timeout=90_000
    )
    page.locator('[data-target="menu-settings"]').click()
    expect(page.locator("#typecheck-stub-status")).to_contain_text(
        "types-requests@",
        timeout=90_000,
    )
    page.screenshot(path=tmp_path / "typechecking-persistent-stub-package.png")

    page.locator("#typecheck-stub-clear").click()
    expect(page.locator("#typecheck-stub-status")).to_have_text(
        "No cached stub packages.",
        timeout=90_000,
    )

    page.locator("#typecheck-enabled").uncheck()
    expect(page.locator("#typecheck-stub-package")).to_be_disabled()
    expect(page.locator("#typecheck-stub-install")).to_be_disabled()
    expect(page.locator("#typecheck-stub-clear")).to_be_disabled()
    expect(page.locator("#typecheck-stub-status")).to_have_text(
        "Enable type checking to view or manage cached stub packages."
    )
