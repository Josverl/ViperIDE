import re

from playwright.sync_api import expect


def default_catalog_version(page):
    """Runtime version the app defaults to when the user did not pick one."""
    return page.evaluate(
        "async () => (await (await fetch("
        "'assets/pyright-worker/assets/micropython-stub-package-catalog.json'"
        ")).json()).defaultRuntimeVersion"
    )


def test_typechecking_autodetects_connected_vm(page, viperide_server, tmp_path):
    console_errors = []
    page.on(
        "console",
        lambda message: (
            console_errors.append(message.text) if message.type == "error" else None
        ),
    )
    page.add_init_script(
        "localStorage.setItem('settings', JSON.stringify({'typecheck-enabled': true}));"
    )

    page.goto(f"{viperide_server}/?vm=1", wait_until="domcontentloaded")

    status = page.locator("#typecheck-tab")
    settings_tab = page.locator('[data-target="menu-settings"]')
    autodetect = page.locator("#typecheck-autodetect")
    family = page.locator("#typecheck-stub-family")
    version = page.locator("#typecheck-stub-version")
    port = page.locator("#typecheck-stub-port")
    board = page.locator("#typecheck-stub-board")
    package = page.locator("#typecheck-stub-selected-package")

    expect(status).to_have_attribute("data-state", "ready", timeout=90_000)
    expect(status).to_have_attribute(
        "title", re.compile(r"standard mode with webassembly stubs"), timeout=90_000
    )
    settings_tab.click()
    expect(autodetect).to_be_checked()
    expect(page.locator("label[for=typecheck-autodetect]")).to_have_text(
        "Autoselect stubs"
    )
    expect(family).to_have_value("micropython")
    expect(port).to_have_value("webassembly")
    expect(board).to_have_value("PYSCRIPT")
    expect(package).to_have_value(re.compile(r"^micropython-webassembly-stubs=="))
    for selector in (family, version, port, board):
        expect(selector).to_be_disabled()
    assert (
        page.evaluate(
            "JSON.parse(localStorage.getItem('settings'))['typecheck-autodetect']"
        )
        is True
    )

    autodetect.uncheck()
    for selector in (family, version, port, board):
        expect(selector).to_be_enabled()
    assert (
        page.evaluate(
            "JSON.parse(localStorage.getItem('settings'))['typecheck-autodetect']"
        )
        is False
    )
    assert console_errors == []
    page.screenshot(path=tmp_path / "typechecking-autodetect-vm.png")


def test_catalog_only_stub_port_can_switch_without_deadlock(
    page, viperide_server, tmp_path
):
    console_errors = []
    page.on(
        "console",
        lambda message: (
            console_errors.append(message.text) if message.type == "error" else None
        ),
    )
    page.add_init_script(
        """
        localStorage.setItem('settings', JSON.stringify({
            'typecheck-enabled': true,
            'typecheck-autodetect': false,
            'typecheck-stub-family': 'micropython',
            'typecheck-stub-version': '1.28.0',
            'typecheck-stub-port': 'esp32',
            'typecheck-stub-board': 'GENERIC'
        }));
        """
    )

    page.goto(f"{viperide_server}/?vm=1", wait_until="domcontentloaded")
    status = page.locator("#typecheck-tab")
    port = page.locator("#typecheck-stub-port")
    package = page.locator("#typecheck-stub-selected-package")

    expect(status).to_have_attribute("data-state", "ready", timeout=90_000)
    page.locator('[data-target="menu-settings"]').click()
    port.select_option("esp8266")
    expect(status).to_have_attribute(
        "title", re.compile(r"standard mode with esp8266 stubs"), timeout=90_000
    )
    expect(package).to_have_value(re.compile(r"^micropython-esp8266"), timeout=90_000)

    port.select_option("esp32")
    expect(status).to_have_attribute(
        "title", re.compile(r"standard mode with esp32 stubs"), timeout=90_000
    )
    expect(package).to_have_value(
        re.compile(r"^micropython-esp32-stubs=="), timeout=90_000
    )
    expect(port).to_be_enabled()
    assert console_errors == []
    page.screenshot(path=tmp_path / "typechecking-catalog-port-switch.png")


def test_typechecking_mode_and_stub_selection_persist(page, viperide_server, tmp_path):
    console_errors = []
    page.on(
        "console",
        lambda message: (
            console_errors.append(message.text) if message.type == "error" else None
        ),
    )
    page.on("dialog", lambda dialog: dialog.dismiss())
    page.add_init_script(
        """
        if (!sessionStorage.getItem('typechecking-settings-test')) {
            localStorage.setItem('settings', JSON.stringify({
                'typecheck-enabled': true,
                'typecheck-autodetect': false
            }));
            sessionStorage.setItem('typechecking-settings-test', 'initialized');
        }
        """
    )

    page.goto(f"{viperide_server}/?vm=1", wait_until="domcontentloaded")

    status = page.locator("#typecheck-tab")
    mode = page.locator("#typecheck-mode")
    scope = page.locator("#typecheck-scope")
    autodetect = page.locator("#typecheck-autodetect")
    family = page.locator("#typecheck-stub-family")
    version = page.locator("#typecheck-stub-version")
    port = page.locator("#typecheck-stub-port")
    board = page.locator("#typecheck-stub-board")
    package = page.locator("#typecheck-stub-selected-package")
    package_row = page.locator(".typecheck-package-info")
    advanced_mode = page.locator("#advanced-mode")
    editor = page.locator(".cm-content")
    settings_tab = page.locator('[data-target="menu-settings"]')

    expect(status).to_have_attribute("data-state", "ready", timeout=90_000)
    expect(status).to_have_attribute(
        "title", re.compile(r"standard mode with esp32 stubs")
    )
    assert (
        page.evaluate("JSON.parse(localStorage.getItem('settings'))['typecheck-mode']")
        == "standard"
    )
    assert (
        page.evaluate("JSON.parse(localStorage.getItem('settings'))['typecheck-scope']")
        == "openFilesOnly"
    )

    settings_tab.click()
    expect(mode).to_have_value("standard")
    expect(scope).to_have_value("openFilesOnly")
    expect(autodetect).not_to_be_checked()
    expect(scope.locator("option[value=workspace]")).to_have_text("All")
    expect(scope.locator("option[value=openFilesOnly]")).to_have_text("Opened")
    expect(family).to_have_value("micropython")
    expect(version).to_have_value(default_catalog_version(page))
    expect(port).to_have_value("esp32")
    expect(board).to_have_value("GENERIC")
    expect(package).to_have_value(
        re.compile(rf"^micropython-esp32-stubs=={re.escape(version.input_value())}")
    )
    expect(package_row).to_be_hidden()
    advanced_mode.check()
    expect(package_row).to_be_visible()
    advanced_mode.uncheck()
    expect(package_row).to_be_hidden()
    assert page.locator("#menu-line-other").evaluate(
        "(other) => Boolean(other.compareDocumentPosition("
        "document.querySelector('#menu-line-typechecking')) & Node.DOCUMENT_POSITION_FOLLOWING)"
    )
    expect(page.locator("#menu-line-typechecking")).to_have_text("Typechecking")
    expect(page.locator("#typecheck-stub-package-help")).to_have_count(0)
    expect(page.locator("label[for=typecheck-stub-family]")).to_have_text("Family")
    expect(page.locator("label[for=typecheck-stub-version]")).to_have_text("Version")
    expect(page.locator("label[for=typecheck-stub-port]")).to_have_text("Port")
    expect(page.locator("label[for=typecheck-stub-board]")).to_have_text("Board")
    expect(page.locator("label[for=typecheck-stub-selected-package]")).to_have_text(
        "Package"
    )
    for dropdown in (mode, scope, family, version, port, board):
        assert (
            dropdown.evaluate("(element) => getComputedStyle(element).textAlign")
            == "right"
        )
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
    expect(status).to_have_attribute(
        "title", re.compile(r"strict mode with esp32 stubs"), timeout=90_000
    )

    port.select_option("rp2")
    expect(status).to_have_attribute(
        "title", re.compile(r"strict mode with rp2 stubs"), timeout=90_000
    )
    board.select_option("RPI_PICO_W")
    expect(package).to_have_value(
        re.compile(r"^micropython-rp2-rpi-pico-w-stubs=="), timeout=90_000
    )
    assert (
        page.evaluate("JSON.parse(localStorage.getItem('settings'))['typecheck-mode']")
        == "strict"
    )
    assert (
        page.evaluate(
            "JSON.parse(localStorage.getItem('settings'))['typecheck-stub-port']"
        )
        == "rp2"
    )
    assert (
        page.evaluate(
            "JSON.parse(localStorage.getItem('settings'))['typecheck-stub-board']"
        )
        == "RPI_PICO_W"
    )

    page.reload(wait_until="domcontentloaded")
    expect(status).to_have_attribute("data-state", "ready", timeout=90_000)
    expect(status).to_have_attribute("title", re.compile(r"strict mode with rp2 stubs"))
    expect(mode).to_have_value("strict")
    expect(scope).to_have_value("openFilesOnly")
    expect(port).to_have_value("rp2")
    expect(board).to_have_value("RPI_PICO_W")
    expect(package).to_have_value(re.compile(r"^micropython-rp2-rpi-pico-w-stubs=="))

    editor.fill("def identity(value):\n    return value\n")
    expect(page.locator("#diagnostics-badge")).not_to_be_empty(timeout=30_000)

    settings_tab.click()
    mode.select_option("basic")
    expect(status).to_have_attribute("data-state", "ready", timeout=90_000)
    expect(status).to_have_attribute("title", re.compile(r"basic mode with rp2 stubs"))
    expect(editor).to_contain_text("def identity(value):")
    assert console_errors == []
    page.screenshot(path=tmp_path / "typechecking-settings-basic-rp2.png")


def test_typechecking_stub_packages_install_and_persist(
    page, viperide_server, tmp_path
):
    page.add_init_script(
        """
        localStorage.setItem('settings', JSON.stringify({
            'typecheck-enabled': true,
            'advanced-mode': true
        }));
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
