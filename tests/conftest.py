import subprocess
import time
import urllib.request
from pathlib import Path

import pytest


def _serves_current_build(url):
    try:
        with urllib.request.urlopen(url, timeout=1) as response:
            return response.status == 200 and b"typecheck-tab" in response.read()
    except Exception:
        return False


@pytest.fixture(scope="session")
def viperide_server():
    build_dir = Path(__file__).parents[1] / "build"
    if not (build_dir / "index.html").exists():
        pytest.fail("ViperIDE build is missing; run `npm run build` before browser tests")

    # Rollup embeds this development origin in the generated HTML and service worker.
    port = 10001
    url = f"http://localhost:{port}"
    if _serves_current_build(url):
        yield url
        return

    process = subprocess.Popen(
        ["python3", "-m", "http.server", str(port), "--directory", str(build_dir)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(25):
        if _serves_current_build(url):
            break
        time.sleep(0.2)
    else:
        process.terminate()
        pytest.fail("ViperIDE browser test server did not start")

    yield url
    process.terminate()
    process.wait(timeout=5)
