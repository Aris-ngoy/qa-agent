#!/usr/bin/env bash
# Yoqa tests its own desktop webview: serve the webview with the e2e harness (stubbed desktop
# host, seeded runner on 4791), start a headless Chromium with a debug port, and run this
# folder's CaseScripts on the web Direct lane through the yoqa runner already serving the CLI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
DESKTOP="$ROOT/apps/desktop"
HERE="$DESKTOP/e2e/yoqa"
cd "$ROOT"

# The harness's fixed ports (apps/desktop/e2e/harness.ts).
WEB_URL="http://localhost:5191"
SEEDED_RUN_URL="http://127.0.0.1:4791/runs/run_e2e_title"
CDP_PORT="${YOQA_DESKTOP_CDP_PORT:-9222}"
SHOT_DIR="${YOQA_SMOKE_SHOTS:-$ROOT/artifacts/screenshots}"

CHROME_BIN="${CHROME_BIN:-$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || true)}"
if [ -z "$CHROME_BIN" ]; then
	echo "No Chromium-family browser found; set CHROME_BIN" >&2
	exit 1
fi
echo "Using $("$CHROME_BIN" --version) at ${CHROME_BIN}"

mkdir -p artifacts "$SHOT_DIR"
PROFILE_DIR="$(mktemp -d)"
pids=()

# Stop the harness (bunx and bun leave children, so stop those first) and the browser. Chrome
# keeps writing its profile while it shuts down, so wait until no process has it open (killing
# stragglers after 10 s) before deleting it. Keep the run's exit status either way.
cleanup() {
	local status=$?
	for pid in ${pids[@]+"${pids[@]}"}; do
		pkill -TERM -P "$pid" >/dev/null 2>&1 || true
		kill "$pid" >/dev/null 2>&1 || true
	done
	for _ in $(seq 1 50); do
		pgrep -f -- "--user-data-dir=${PROFILE_DIR}" >/dev/null || break
		sleep 0.2
	done
	pkill -KILL -f -- "--user-data-dir=${PROFILE_DIR}" >/dev/null 2>&1 || true
	rm -rf "$PROFILE_DIR" 2>/dev/null || true
	exit "$status"
}
trap cleanup EXIT

(cd "$DESKTOP" && exec bun e2e/start-runner.ts) >artifacts/desktop-runner.log 2>&1 &
pids+=("$!")
(cd "$DESKTOP" && exec bunx vite --config vite.e2e.config.ts) >artifacts/desktop-vite.log 2>&1 &
pids+=("$!")

# Chrome 136+ only allows remote debugging on a non-default profile. --no-sandbox because
# Ubuntu 24.04 runners restrict the unprivileged user namespaces Chrome's sandbox needs.
"$CHROME_BIN" \
	--headless=new \
	--no-sandbox \
	--remote-debugging-port="$CDP_PORT" \
	--user-data-dir="$PROFILE_DIR" \
	--no-first-run \
	--no-default-browser-check \
	--disable-gpu \
	about:blank >artifacts/chrome.log 2>&1 &
pids+=("$!")

wait_for() {
	local url="$1" name="$2"
	for _ in $(seq 1 90); do
		curl -sf "$url" >/dev/null && return 0
		sleep 1
	done
	echo "${name} did not answer at ${url}" >&2
	return 1
}

# The seeded Run answering means the webview's runner is up and seeded, not only listening.
wait_for "$SEEDED_RUN_URL" "Seeded desktop e2e runner"
wait_for "$WEB_URL" "Desktop webview (Vite)"
wait_for "http://127.0.0.1:${CDP_PORT}/json/version" "Chromium DevTools endpoint"

# The desktop preset (1280×800) is the window size the desktop app opens at.
yoqa devices connect "chromium-cdp-${CDP_PORT}"

# One App whose Web URL is the webview, and one case per CaseScript in this folder.
if ! yoqa apps get DESK >/dev/null 2>&1; then
	yoqa apps create --name "Yoqa Desktop" --prefix DESK --web-url "$WEB_URL"
else
	yoqa apps update DESK --web-url "$WEB_URL"
fi
seed_case() {
	local number="$1" title="$2" script="$3"
	if ! yoqa cases get DESK "$number" >/dev/null 2>&1; then
		yoqa cases create DESK --title "$title" --script-file "$script"
	else
		yoqa cases update DESK "$number" --script-file "$script"
	fi
}
seed_case 1 "Open the seeded test case and Run" "$HERE/open-case-and-run.yoqa.yaml"
seed_case 2 "Create and rename a test case" "$HERE/create-case.yoqa.yaml"

status=0
yoqa runs create DESK --cases 1,2 --mode script --wait --github-output || status=$?

# Where the Run left the webview; the HTML report has a screenshot for every step.
yoqa screenshot "$SHOT_DIR/desktop-final.png" || true
if [ "$status" -ne 0 ]; then
	yoqa screen --json >artifacts/desktop-screen.json || true
fi
exit "$status"
