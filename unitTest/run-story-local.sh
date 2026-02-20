#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

temp_source_dir=""
temp_log_file=""
interrupted=false

cleanup() {
    if [[ "$interrupted" == "true" ]]; then
        echo ""
        echo "Stopped."
    fi
    if [[ -n "$temp_source_dir" && -d "$temp_source_dir" ]]; then
        rm -rf "$temp_source_dir"
    fi
    if [[ -n "$temp_log_file" && -f "$temp_log_file" ]]; then
        rm -f "$temp_log_file"
    fi
}
handle_int() { interrupted=true; }
trap cleanup EXIT
trap handle_int INT TERM

story_list_file="${STORY_LIST_FILE:-unitTest/story-links.txt}"
default_firefox_profile="${DEV_STORY_FIREFOX_PROFILE:-tmp/webtoepub-firefox-profile}"
use_all_stories="false"
declare -a story_urls=()
declare -a web_ext_args=()

usage() {
    cat <<'EOF'
Usage:
  bash unitTest/run-story-local.sh [story-url] [web-ext options...]
  bash unitTest/run-story-local.sh --all-stories [web-ext options...]

Options:
  --all-stories        Open all URLs from unitTest/story-links.txt
  --story-list <path>  Use a different story list file (one URL per line)
  --help               Show this help

Environment variables:
    DEV_STORY_REMOVE_STRICT_MIN_VERSION=1  Force remove strict_min_version before launch
    DEV_STORY_KEEP_STRICT_MIN_VERSION=1    Never remove strict_min_version or auto-retry
    DEV_STORY_FIREFOX_PROFILE=<path>       Firefox profile path (default: tmp/webtoepub-firefox-profile)

Examples:
  npm run dev:story
  npm run dev:story -- "https://www.royalroad.com/fiction/39408/beware-of-chicken"
  npm run dev:story:all
  npm run dev:story:all -- --firefox-profile ./tmp/webtoepub-profile
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --all-stories)
            use_all_stories="true"
            shift
            ;;
        --story-list)
            shift
            if [[ $# -eq 0 ]]; then
                echo "Missing value for --story-list" >&2
                exit 1
            fi
            story_list_file="$1"
            shift
            ;;
        --help)
            usage
            exit 0
            ;;
        --*)
            web_ext_args+=("$1")
            shift
            ;;
        *)
            story_urls+=("$1")
            shift
            ;;
    esac
done

read_story_list() {
    local file_path="$1"
    if [[ ! -f "$file_path" ]]; then
        echo "Story list file not found: $file_path" >&2
        exit 1
    fi

    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%%#*}"
        line="$(printf '%s' "$line" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
        if [[ -n "$line" ]]; then
            story_urls+=("$line")
        fi
    done < "$file_path"
}

if [[ "$use_all_stories" == "true" ]]; then
    read_story_list "$story_list_file"
fi

if [[ ${#story_urls[@]} -eq 0 ]]; then
    if [[ -n "${STORY_URL:-}" ]]; then
        story_urls=("$STORY_URL")
    else
        read_story_list "$story_list_file"
        story_urls=("${story_urls[0]}")
    fi
fi

if ! command -v npx >/dev/null 2>&1; then
    echo "npx is required but was not found in PATH." >&2
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "node is required but was not found in PATH." >&2
    exit 1
fi

echo "Launching WebToEpub in Firefox with story URL(s):"
for url in "${story_urls[@]}"; do
    echo "- $url"
done
echo "Tip: click the extension toolbar icon to open WebToEpub popup on that page."

prepare_source_without_strict_min_version() {
    temp_source_dir="$(mktemp -d)"
    cp -R "plugin/." "$temp_source_dir/"
    node -e '
const fs = require("fs");
const manifestPath = process.argv[1];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.browser_specific_settings?.gecko?.strict_min_version) {
  delete manifest.browser_specific_settings.gecko.strict_min_version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log("Using temporary dev manifest without strict_min_version for local Firefox compatibility.");
}
' "$temp_source_dir/manifest.json"
}

has_firefox_profile_arg() {
    local previous=""
    for arg in "${web_ext_args[@]}"; do
        if [[ "$previous" == "--firefox-profile" ]]; then
            return 0
        fi
        if [[ "$arg" == --firefox-profile=* ]]; then
            return 0
        fi
        previous="$arg"
    done
    return 1
}

ensure_dev_firefox_profile() {
    mkdir -p "$default_firefox_profile"
    cat > "$default_firefox_profile/user.js" <<'EOF'
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("startup.homepage_welcome_url", "about:blank");
user_pref("startup.homepage_welcome_url.additional", "");
user_pref("trailhead.firstrun.didSeeAboutWelcome", true);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.newtabpage.enabled", false);
EOF
}

build_cmd() {
    local source_dir="$1"
    cmd=(npx web-ext run --source-dir "$source_dir" --verbose)

    if ! has_firefox_profile_arg; then
        ensure_dev_firefox_profile
        cmd+=(--firefox-profile "$default_firefox_profile")
    fi

    cmd+=(
        --pref "devtools.console.stdout.chrome=true"
        --pref "devtools.console.stdout.content=true"
        --pref "browser.dom.window.dump.enabled=true"
        --pref "extensions.webextensions.warnings-as-errors=false"
    )

    for url in "${story_urls[@]}"; do
        cmd+=(--start-url "$url")
    done
    if [[ ${#web_ext_args[@]} -gt 0 ]]; then
        cmd+=("${web_ext_args[@]}")
    fi
}

run_web_ext_with_log() {
    local source_dir="$1"
    local output_file="$2"

    build_cmd "$source_dir"
    echo "web-ext command: ${cmd[*]}"
    set +e
    "${cmd[@]}" 2>&1 | tee "$output_file"
    local exit_code=${PIPESTATUS[0]}
    set -e
    if [[ "$interrupted" == "true" ]]; then exit 0; fi
    return "$exit_code"
}

is_strict_min_version_failure() {
    local output_file="$1"
    grep -Eqi \
        -e "strict_min_version" \
        -e "requires Firefox" \
        -e "not compatible with your version of Firefox" \
        -e "temporar(y|ily).+add-on.+not compatible" \
        "$output_file"
}

source_dir="plugin"
force_remove_strict="${DEV_STORY_REMOVE_STRICT_MIN_VERSION:-${DEV_REMOVE_STRICT_MIN_VERSION:-0}}"
keep_strict="${DEV_STORY_KEEP_STRICT_MIN_VERSION:-${DEV_KEEP_STRICT_MIN_VERSION:-0}}"

if [[ "$force_remove_strict" == "1" && "$keep_strict" != "1" ]]; then
    prepare_source_without_strict_min_version
    source_dir="$temp_source_dir"
fi

temp_log_file="$(mktemp)"

if run_web_ext_with_log "$source_dir" "$temp_log_file"; then
    exit 0
fi
first_run_exit_code=$?

if [[ "$source_dir" != "plugin" ]]; then
    exit "$first_run_exit_code"
fi

if [[ "$keep_strict" == "1" ]]; then
    exit "$first_run_exit_code"
fi

if ! is_strict_min_version_failure "$temp_log_file"; then
    exit "$first_run_exit_code"
fi

echo "Detected Firefox extension compatibility failure. Retrying with strict_min_version removed for local dev run..."
prepare_source_without_strict_min_version
run_web_ext_with_log "$temp_source_dir" "$temp_log_file"
