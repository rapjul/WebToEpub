#!/usr/bin/env python3
"""
Headless QUnit test runner using Python Playwright.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


def wait_for_server(url: str, timeout_seconds: float = 15.0) -> None:
    start = time.time()
    while (time.time() - start) < timeout_seconds:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as response:
                if 200 <= response.status < 500:
                    return
        except Exception:
            pass
        time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for test server at {url}")


def run() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        print(
            "Python Playwright is not available. Install/enable it or use `npm run test:headless:js`.",
            file=sys.stderr,
        )
        return 1

    port = "8082"
    base_url = f"http://127.0.0.1:{port}"
    tests_url = f"{base_url}/unitTest/Tests.html?headless=1&_={int(time.time() * 1000)}"

    repo_root = Path(__file__).resolve().parents[1]
    server = subprocess.Popen(
        ["npx", "http-server", "-p", port, "-c-1"],
        cwd=str(repo_root),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    try:
        wait_for_server(f"{base_url}/unitTest/Tests.html")

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()

            console_errors: list[str] = []
            not_found_urls: set[str] = set()

            def on_response(response):
                if response.status == 404:
                    not_found_urls.add(response.url)

            def on_console(msg):
                if msg.type == "error":
                    text = msg.text
                    is_generic_404_message = (
                        "Failed to load resource" in text and "404" in text
                    )
                    if not is_generic_404_message:
                        console_errors.append(text)

            page.on("response", on_response)
            page.on("console", on_console)
            page.goto(tests_url, wait_until="load")

            page.wait_for_function(
                """
                () => {
                    const el = document.getElementById('qunit-testresult');
                    return !!el && /completed/i.test(el.textContent || '');
                }
                """,
                timeout=180000,
            )

            result = page.evaluate(
                """
                () => {
                    const stats = (window.QUnit && window.QUnit.config && window.QUnit.config.stats)
                        ? window.QUnit.config.stats
                        : null;
                    const text = document.getElementById('qunit-testresult')?.textContent?.trim() ?? '';
                    const failedTests = [...document.querySelectorAll('#qunit-tests > li.fail')].map(li => {
                        const name = li.querySelector('.test-name')?.textContent?.trim() || '(unknown)';
                        const moduleName = li.querySelector('.module-name')?.textContent?.trim() || '(module?)';
                        const assertions = [...li.querySelectorAll('ol.qunit-assert-list > li')]
                            .map(a => a.textContent?.trim())
                            .filter(Boolean);
                        return {
                            testName: `${moduleName} :: ${name}`,
                            assertions,
                        };
                    });
                    return {
                        text,
                        passed: stats?.bad != null ? (stats.all - stats.bad) : null,
                        failed: stats?.bad ?? null,
                        total: stats?.all ?? null,
                        failedTests,
                    };
                }
                """
            )

            summary_text = result.get("text") or "QUnit run completed."
            summary_text = (
                summary_text.replace(".", ".\n", 1)
                if "." in summary_text
                else summary_text
            )
            print(summary_text)
            failed_tests = result.get("failedTests") or []
            if failed_tests:
                print("\nFailed tests:")
                for test in failed_tests:
                    print(f"- {test.get('testName', '(unknown)')}")
                    for assertion in test.get("assertions") or []:
                        print(f"  * {assertion}")

            if console_errors:
                print("\nBrowser console errors:")
                for error in console_errors:
                    print(f"- {error}")

            actionable_404s = []
            for raw_url in sorted(not_found_urls):
                if raw_url.endswith("/favicon.ico"):
                    continue
                try:
                    from urllib.parse import urlparse

                    parsed = urlparse(raw_url)
                    if parsed.path.startswith("//"):
                        continue
                except Exception:
                    pass
                actionable_404s.append(raw_url)
            if actionable_404s:
                print("\nMissing resources (404):")
                for url in actionable_404s:
                    print(f"- {url}")

            browser.close()

            return 1 if (result.get("failed") or 0) > 0 else 0

    finally:
        server.terminate()
        try:
            server.wait(timeout=2)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    sys.exit(run())
