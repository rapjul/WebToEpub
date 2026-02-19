#!/usr/bin/env bash
set -euo pipefail

mode="--auto"
if [[ $# -gt 0 ]]; then
    mode="$1"
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

run_js() {
    node unitTest/run-headless.js
}

run_py() {
    if command -v playwright >/dev/null 2>&1; then
        playwright_bin="$(command -v playwright)"
        shebang_line="$(head -n 1 "$playwright_bin" 2>/dev/null || true)"
        if [[ "$shebang_line" == '#!'* ]]; then
            playwright_python="${shebang_line#\#!}"
            if [[ -x "$playwright_python" ]]; then
                "$playwright_python" unitTest/run-headless.py
                return $?
            fi
        fi
    fi

    if command -v python3 >/dev/null 2>&1; then
        python3 unitTest/run-headless.py
        return $?
    elif command -v python >/dev/null 2>&1; then
        python unitTest/run-headless.py
        return $?
    else
        echo "Python is not available for headless test runner." >&2
        exit 1
    fi
}

run_cli() {
    bash unitTest/run-headless-playwright-cli.sh
}

case "$mode" in
    --auto)
        if node -e "require.resolve('playwright')" >/dev/null 2>&1; then
            if run_js; then
                exit 0
            fi
        fi

        if run_py; then
            exit 0
        fi

        if command -v playwright-cli >/dev/null 2>&1; then
            if run_cli; then
                exit 0
            fi
        fi

        echo "All headless runners failed (js, py, playwright-cli)." >&2
        exit 1
        ;;
    --py)
        run_py
        ;;
    --js)
        run_js
        ;;
    --cli)
        run_cli
        ;;
    *)
        echo "Unknown mode: $mode" >&2
        echo "Usage: bash unitTest/run-headless.sh [--auto|--js|--py|--cli]" >&2
        exit 2
        ;;
esac
