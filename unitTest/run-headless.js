"use strict";

const http = require("http");
const { spawn } = require("child_process");

async function waitForServer(url, timeoutMs = 15000) {
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs) {
        const ok = await new Promise((resolve) => {
            const req = http.get(url, (res) => {
                res.resume();
                resolve(res.statusCode >= 200 && res.statusCode < 500);
            });
            req.on("error", () => resolve(false));
            req.setTimeout(1000, () => {
                req.destroy();
                resolve(false);
            });
        });
        if (ok) {
            return;
        }
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`Timed out waiting for test server at ${url}`);
}

async function main() {
    let playwright;
    try {
        playwright = require("playwright");
    } catch {
        throw new Error("Node Playwright module not found. Use `npm run test:headless:py` or install playwright locally.");
    }

    const port = process.env.HEADLESS_TEST_PORT || "8082";
    const baseUrl = `http://127.0.0.1:${port}`;
    const testsUrl = `${baseUrl}/unitTest/Tests.html?headless=1&_=${Date.now()}`;

    const server = spawn("npx", ["http-server", "-p", String(port), "-c-1"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"]
    });

    let serverOutput = "";
    server.stdout.on("data", (d) => { serverOutput += d.toString(); });
    server.stderr.on("data", (d) => { serverOutput += d.toString(); });

    let browser;
    try {
        await waitForServer(`${baseUrl}/unitTest/Tests.html`);
        browser = await playwright.chromium.launch({ headless: true });
        const page = await browser.newPage();

        const consoleErrors = [];
        const notFoundUrls = new Set();
        page.on("response", (response) => {
            if (response.status() === 404) {
                notFoundUrls.add(response.url());
            }
        });
        page.on("console", (msg) => {
            if (msg.type() === "error") {
                const text = msg.text();
                const isGeneric404Message = text.includes("Failed to load resource")
                    && text.includes("404");
                if (!isGeneric404Message) {
                    consoleErrors.push(text);
                }
            }
        });

        await page.goto(testsUrl, { waitUntil: "load" });

        await page.waitForFunction(() => {
            const el = document.getElementById("qunit-testresult");
            return !!el && /completed/i.test(el.textContent || "");
        }, { timeout: 180000 });

        const result = await page.evaluate(() => {
            const stats = (window.QUnit && window.QUnit.config && window.QUnit.config.stats)
                ? window.QUnit.config.stats
                : null;
            const text = document.getElementById("qunit-testresult")?.textContent?.trim() ?? "";
            const failedTests = [...document.querySelectorAll("#qunit-tests > li.fail")].map(li => {
                const name = li.querySelector(".test-name")?.textContent?.trim() || "(unknown)";
                const moduleName = li.querySelector(".module-name")?.textContent?.trim() || "(module?)";
                return `${moduleName} :: ${name}`;
            });
            return {
                text,
                passed: stats?.bad != null ? (stats.all - stats.bad) : null,
                failed: stats?.bad ?? null,
                total: stats?.all ?? null,
                failedTests
            };
        });

        const summaryText = (result.text || "QUnit run completed.").replace(".", ".\n");
        console.log(summaryText);
        if (result.failedTests.length > 0) {
            console.log("\nFailed tests:");
            for (const testName of result.failedTests) {
                console.log(`- ${testName}`);
            }
        }
        if (consoleErrors.length > 0) {
            console.log("\nBrowser console errors:");
            for (const errorLine of consoleErrors) {
                console.log(`- ${errorLine}`);
            }
        }
        const actionable404s = [...notFoundUrls].filter((rawUrl) => {
            if (rawUrl.endsWith("/favicon.ico")) {
                return false;
            }
            try {
                const parsed = new URL(rawUrl);
                if (parsed.pathname.startsWith("//")) {
                    return false;
                }
            } catch {
            }
            return true;
        });
        if (actionable404s.length > 0) {
            console.log("\nMissing resources (404):");
            for (const url of actionable404s) {
                console.log(`- ${url}`);
            }
        }

        if ((result.failed ?? 0) > 0) {
            process.exitCode = 1;
        }
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
        server.kill("SIGTERM");
        await new Promise(r => setTimeout(r, 300));
        if (!server.killed) {
            server.kill("SIGKILL");
        }
    }
}

main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
});
