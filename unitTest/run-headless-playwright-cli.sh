#!/usr/bin/env bash
set -euo pipefail

port="${HEADLESS_TEST_PORT:-8082}"
base_url="http://127.0.0.1:${port}"
tests_url="${base_url}/unitTest/Tests.html?headless=1&_=$(date +%s%3N)"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

if ! command -v playwright-cli >/dev/null 2>&1; then
    echo "playwright-cli is not available." >&2
    exit 1
fi

server_pid=""
cleanup() {
    playwright-cli close >/dev/null 2>&1 || true
    if [[ -n "${server_pid}" ]]; then
        kill "${server_pid}" >/dev/null 2>&1 || true
        wait "${server_pid}" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

npx http-server -p "${port}" -c-1 >/dev/null 2>&1 &
server_pid="$!"

for _ in $(seq 1 60); do
    if curl -fsS "${base_url}/unitTest/Tests.html" >/dev/null 2>&1; then
        break
    fi
    sleep 0.25
done

extract_result_line() {
    awk '/^### Result/{getline; print; exit}'
}

run_eval() {
    local script="$1"
    local output
    output="$(playwright-cli eval "$script" 2>/dev/null || true)"
    printf "%s\n" "$output" | extract_result_line
}

playwright-cli open "$tests_url" >/dev/null

is_done="false"
for _ in $(seq 1 360); do
    is_done="$(run_eval "() => { const el = document.getElementById('qunit-testresult'); return !!el && /completed/i.test(el.textContent || ''); }")"
    if [[ "$is_done" == "true" ]]; then
        break
    fi
    sleep 0.5
done

if [[ "$is_done" != "true" ]]; then
    echo "Timed out waiting for QUnit completion in playwright-cli runner." >&2
    exit 1
fi

summary_json="$(run_eval "() => JSON.stringify((() => { const stats = (window.QUnit && window.QUnit.config && window.QUnit.config.stats) ? window.QUnit.config.stats : null; const text = document.getElementById('qunit-testresult')?.textContent?.trim() ?? ''; const failedTests = [...document.querySelectorAll('#qunit-tests > li.fail')].map(li => { const name = li.querySelector('.test-name')?.textContent?.trim() || '(unknown)'; const moduleName = li.querySelector('.module-name')?.textContent?.trim() || '(module?)'; return moduleName + ' :: ' + name; }); return { text, passed: stats?.bad != null ? (stats.all - stats.bad) : null, failed: stats?.bad ?? null, total: stats?.all ?? null, failedTests }; })())")"

if [[ -z "$summary_json" ]]; then
    echo "Could not read QUnit summary from playwright-cli." >&2
    exit 1
fi

node -e '
const summary = JSON.parse(process.argv[1]);
const summaryText = (summary.text || "QUnit run completed.").replace(".", ".\\n");
console.log(summaryText);
if ((summary.failedTests || []).length) {
  console.log("\nFailed tests:");
  for (const testName of summary.failedTests) console.log(`- ${testName}`);
}
process.exit((summary.failed || 0) > 0 ? 1 : 0);
' "$summary_json"
