#!/usr/bin/env bash
# Serve the Expo demo's web export, start a headless Chromium with a debug port, and run
# the Yoqa smoke on the web Direct lane (attach by port, mobile Viewport preset).
# Usage: ci-web.sh [web-export-dir]   (default: examples/expo-demo/dist, from `expo export`)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WEB_DIR="${1:-$ROOT/examples/expo-demo/dist}"
if [ -d "$WEB_DIR" ]; then
	WEB_DIR="$(cd "$WEB_DIR" && pwd)"
fi
cd "$ROOT"

WEB_PORT="${YOQA_DEMO_WEB_PORT:-8081}"
CDP_PORT="${YOQA_DEMO_CDP_PORT:-9222}"
WEB_URL="http://127.0.0.1:${WEB_PORT}"

if [ ! -f "$WEB_DIR/index.html" ]; then
	echo "No web export at ${WEB_DIR} (run: npx expo export --platform web)" >&2
	exit 1
fi

CHROME_BIN="${CHROME_BIN:-$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || true)}"
if [ -z "$CHROME_BIN" ]; then
	echo "No Chromium-family browser found; set CHROME_BIN" >&2
	exit 1
fi
echo "Using $("$CHROME_BIN" --version) at ${CHROME_BIN}"

mkdir -p artifacts
PROFILE_DIR="$(mktemp -d)"
pids=()

# Chrome keeps writing its profile while it shuts down, so wait until no process has it open
# (killing stragglers after 10 s) before deleting it. Keep the smoke's exit status either way.
cleanup() {
	local status=$?
	for pid in ${pids[@]+"${pids[@]}"}; do
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

capture_failure() {
	yoqa screenshot artifacts/web-failure.png || true
	yoqa screen --json >artifacts/web-screen.json || true
}

python3 -m http.server "$WEB_PORT" --bind 127.0.0.1 --directory "$WEB_DIR" \
	>artifacts/web-server.log 2>&1 &
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
	for _ in $(seq 1 60); do
		curl -sf "$url" >/dev/null && return 0
		sleep 1
	done
	echo "${name} did not answer at ${url}" >&2
	return 1
}

wait_for "$WEB_URL" "Demo web server"
wait_for "http://127.0.0.1:${CDP_PORT}/json/version" "Chromium DevTools endpoint"

# The mobile preset (390×844, touch) lays the React Native Web build out as on a phone.
yoqa devices connect "chromium-cdp-${CDP_PORT}" --viewport mobile
YOQA_DEMO_WEB_URL="$WEB_URL" bash examples/expo-demo/yoqa/seed-catalog.sh

# The catalog Run opens the App's Web URL itself, before the first case.
status=0
yoqa runs create DEMO --cases 1 --mode script --wait --github-output || status=$?

# The same steps through the connector, for a screenshot after every action. Reloading
# the Web URL resets the demo to its home screen.
if yoqa action open-url --url "$WEB_URL"; then
	bash examples/expo-demo/yoqa/ci-smoke.sh || status=$?
else
	status=1
fi

if [ "$status" -ne 0 ]; then
	capture_failure
fi
exit "$status"
