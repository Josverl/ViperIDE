import json
import re

import pytest
from playwright.sync_api import expect


MANIFEST_REQUEST = re.compile(r"/pyright-worker/assets/stubs-manifest\.json$")


def _configure_typechecking(page, **overrides):
    settings = {
        "typecheck-enabled": True,
        "typecheck-mode": "standard",
        "typecheck-scope": "workspace",
        "typecheck-stubs": "auto",
        **overrides,
    }
    page.add_init_script(f"localStorage.setItem('settings', {json.dumps(json.dumps(settings))});")


def _console_errors(page):
    errors = []
    page.on(
        "console",
        lambda message: errors.append(message.text) if message.type == "error" else None,
    )
    return errors


def _create_python_file(page, path, content):
    page.once("dialog", lambda dialog: dialog.accept(path))
    page.evaluate("app.createNewFile('/')")
    expect(page.locator("#editor-tabs .tab.active")).to_have_attribute("data-fn", f"/{path}")
    page.locator(".editor-tab-pane.active .cm-content").fill(content)


def _pyright_rows(page, path):
    return page.locator(f'#diagnostics-list .diagnostic-item[data-path="{path}"]').filter(
        has=page.locator(".diagnostic-source", has_text="Pyright")
    )


def _expect_vm_typechecking_ready(page):
    status = page.locator("#typecheck-tab")
    expect(status).to_have_attribute("data-state", "ready", timeout=90_000)
    expect(status).to_have_attribute("title", re.compile(r"standard mode with webassembly stubs"), timeout=90_000)
    return status


@pytest.mark.parametrize(
    ("failure_name", "request_pattern", "response_status"),
    [
        pytest.param("manifest", MANIFEST_REQUEST, 503, id="manifest-http-error"),
    ],
)
def test_typechecking_startup_failure_is_visible_and_retryable(
    page,
    context,
    viperide_server,
    tmp_path,
    failure_name,
    request_pattern,
    response_status,
):
    _configure_typechecking(page)
    blocked_requests = []

    def fail_request(route):
        blocked_requests.append(route.request.url)
        if response_status is None:
            route.abort("failed")
        else:
            route.fulfill(
                status=response_status,
                content_type="text/plain",
                body="temporary type-checking asset failure",
            )

    context.route(request_pattern, fail_request)
    page.goto(f"{viperide_server}/?vm=1", wait_until="domcontentloaded")

    status = page.locator("#typecheck-tab")
    enabled = page.locator("#typecheck-enabled")
    expect(status).to_have_attribute("data-state", "error", timeout=45_000)
    expect(status).to_have_attribute(
        "title",
        re.compile(
            r"Pyright failed: .+Disable and enable type checking in Settings to retry\.",
            re.IGNORECASE,
        ),
    )
    expect(enabled).to_be_enabled()
    expect(page.locator(".cm-content")).to_be_visible(timeout=30_000)
    assert blocked_requests
    page.screenshot(path=tmp_path / f"typechecking-startup-{failure_name}-error.png")

    context.unroute(request_pattern, fail_request)
    page.locator('[data-target="menu-settings"]').click()
    enabled.uncheck()
    expect(status).to_have_attribute("data-state", "disabled")
    enabled.check()

    _expect_vm_typechecking_ready(page)
    expect(page.locator(".cm-content")).to_be_visible()
    page.screenshot(path=tmp_path / f"typechecking-startup-{failure_name}-recovered.png")


def test_local_imports_follow_changes_across_open_tabs(page, viperide_server, tmp_path):
    console_errors = _console_errors(page)
    _configure_typechecking(page, **{"typecheck-scope": "openFilesOnly"})
    page.goto(f"{viperide_server}/?vm=1", wait_until="domcontentloaded")

    status = _expect_vm_typechecking_ready(page)

    _create_python_file(
        page,
        "helper.py",
        "def make_label(value: int) -> str:\n    return str(value)\n",
    )
    _create_python_file(
        page,
        "consumer.py",
        "from helper import make_label\n\nlabel: int = make_label(1)\n",
    )

    page.locator('[data-target="diagnostics"]').click()
    consumer_rows = _pyright_rows(page, "/consumer.py")
    expect(consumer_rows).to_have_count(1, timeout=30_000)
    expect(consumer_rows.first).to_contain_text("not assignable")
    expect(consumer_rows.first).not_to_contain_text("could not be resolved")

    page.locator('#editor-tabs .tab[data-fn="/helper.py"]').click()
    page.locator(".editor-tab-pane.active .cm-content").fill("def make_label(value: int) -> int:\n    return value\n")

    expect(consumer_rows).to_have_count(0, timeout=30_000)
    page.locator('#editor-tabs .tab[data-fn="/consumer.py"]').click()
    expect(page.locator(".editor-tab-pane.active .cm-content")).to_contain_text("from helper import make_label")
    expect(status).to_have_attribute("data-state", "ready")
    assert console_errors == []
    page.screenshot(path=tmp_path / "typechecking-local-multi-tab-imports.png")


def test_dotted_completion_opens_on_every_first_trigger(page, viperide_server, tmp_path):
    console_errors = _console_errors(page)
    _configure_typechecking(page, **{"typecheck-scope": "openFilesOnly"})
    page.goto(f"{viperide_server}/?vm=1", wait_until="domcontentloaded")

    _expect_vm_typechecking_ready(page)
    editor = page.locator(".editor-tab-pane.active .cm-content")
    autocomplete = page.locator(".cm-tooltip-autocomplete")

    for _ in range(5):
        editor.fill("import time as t\n")
        editor.press_sequentially("t.", delay=30)
        expect(autocomplete).to_be_visible(timeout=15_000)
        expect(autocomplete.locator(".cm-completionLabel", has_text="sleep").first).to_be_visible()
        page.keyboard.press("Escape")
        expect(autocomplete).to_be_hidden()

    editor.fill("import time as t\n")
    editor.press_sequentially("t.", delay=30)
    expect(autocomplete).to_be_visible(timeout=15_000)
    expect(autocomplete.locator(".cm-completionLabel", has_text="sleep").first).to_be_visible()
    assert console_errors == []
    page.screenshot(path=tmp_path / "typechecking-dotted-autocomplete.png")


def test_fast_tab_switching_keeps_content_and_diagnostics_with_their_files(page, viperide_server, tmp_path):
    console_errors = _console_errors(page)
    _configure_typechecking(page, **{"typecheck-scope": "openFilesOnly"})
    page.goto(f"{viperide_server}/?vm=1", wait_until="domcontentloaded")

    status = _expect_vm_typechecking_ready(page)
    _create_python_file(page, "switch_a.py", 'only_a: int = "wrong"\n')
    _create_python_file(page, "switch_b.py", "only_b: str = 42\n")

    page.locator('[data-target="diagnostics"]').click()
    first_rows = _pyright_rows(page, "/switch_a.py")
    second_rows = _pyright_rows(page, "/switch_b.py")
    expect(first_rows).to_have_count(1, timeout=30_000)
    expect(second_rows).to_have_count(1, timeout=30_000)

    page.evaluate(
        """
        for (let index = 0; index < 25; index++) {
            document.querySelector('#editor-tabs .tab[data-fn="/switch_a.py"]').click();
            document.querySelector('#editor-tabs .tab[data-fn="/switch_b.py"]').click();
        }
        document.querySelector('#editor-tabs .tab[data-fn="/switch_a.py"]').click();
        """
    )
    expect(page.locator("#editor-tabs .tab.active")).to_have_attribute("data-fn", "/switch_a.py")
    active_editor = page.locator(".editor-tab-pane.active .cm-content")
    expect(active_editor).to_contain_text('only_a: int = "wrong"')
    active_editor.fill("only_a: int = 1\n")

    expect(first_rows).to_have_count(0, timeout=30_000)
    expect(second_rows).to_have_count(1)
    page.locator('#editor-tabs .tab[data-fn="/switch_b.py"]').click()
    expect(page.locator(".editor-tab-pane.active .cm-content")).to_contain_text("only_b: str = 42")
    expect(status).to_have_attribute("data-state", "ready")
    assert console_errors == []
    page.screenshot(path=tmp_path / "typechecking-fast-tab-switching.png")


def test_connected_vm_auto_stubs_and_manual_stub_changes_reanalyze_open_files(page, viperide_server, tmp_path):
    console_errors = _console_errors(page)
    _configure_typechecking(page, **{"typecheck-scope": "openFilesOnly"})
    page.goto(f"{viperide_server}/?vm=1", wait_until="domcontentloaded")

    status = _expect_vm_typechecking_ready(page)
    editor = page.locator(".editor-tab-pane.active .cm-content")

    editor.fill("import rp2\n")
    page.locator('[data-target="diagnostics"]').click()
    missing_rp2 = _pyright_rows(page, "/main.py").filter(has_text='Import "rp2" could not be resolved')
    expect(missing_rp2).to_have_count(1, timeout=30_000)

    page.locator('[data-target="menu-settings"]').click()
    board = page.locator("#typecheck-stubs")
    expect(board).to_have_value("auto")
    board.select_option("rp2")
    expect(status).to_have_attribute("title", re.compile(r"standard mode with rp2 stubs"), timeout=90_000)
    expect(missing_rp2).to_have_count(0, timeout=30_000)
    expect(editor).to_contain_text("import rp2")
    page.screenshot(path=tmp_path / "typechecking-rp2-stubs-resolve-import.png")

    board.select_option("auto")
    expect(status).to_have_attribute("title", re.compile(r"standard mode with webassembly stubs"), timeout=90_000)
    expect(missing_rp2).to_have_count(1, timeout=30_000)
    expect(editor).to_contain_text("import rp2")
    assert console_errors == []
