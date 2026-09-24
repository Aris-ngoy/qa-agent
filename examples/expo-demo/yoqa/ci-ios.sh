#!/usr/bin/env bash
# Connect Yoqa to a booted iOS Simulator and run the Expo demo smoke.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

UDID="${1:-}"
if [ -z "$UDID" ]; then
	UDID="$(xcrun simctl list devices booted -j | python3 -c '
import json, sys
data = json.load(sys.stdin)
for rows in data.get("devices", {}).values():
    for device in rows:
        if device.get("state") == "Booted" and "iPhone" in device.get("name", ""):
            print(device["udid"])
            raise SystemExit
raise SystemExit("No booted iPhone simulator")
')"
fi

if [ -z "$UDID" ]; then
	echo "No iOS Simulator UDID" >&2
	xcrun simctl list devices booted >&2 || true
	exit 1
fi

echo "Using iOS Simulator ${UDID}"

capture_failure() {
	mkdir -p artifacts
	yoqa screenshot artifacts/ios-failure.png || true
	yoqa screen --json >artifacts/ios-screen.json || true
	# The tool-server log explains empty trees / dead sessions far better than
	# the symptom ("Expected visible text not found within 60s").
	argent server logs >artifacts/argent-server.log 2>&1 || true
}

trap capture_failure ERR

# WDA simulator boot can wedge under CI load (Appium's bootstatus fails after
# ~126s). Retry connect, re-booting the simulator between attempts.
connect_device() {
	local attempt
	for attempt in 1 2 3; do
		if yoqa devices connect "$UDID" --platform ios --bundle-id ai.yoqa.demo; then
			return 0
		fi
		echo "devices connect attempt ${attempt} failed; retrying"
		sleep 15
		xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
		xcrun simctl boot "$UDID" >/dev/null 2>&1
		xcrun simctl bootstatus "$UDID" -b >/dev/null
	done
	return 1
}

connect_device

# A reboot between attempts closes the app — bring it back to the foreground.
xcrun simctl launch "$UDID" ai.yoqa.demo >/dev/null 2>&1 || true

yoqa devices connect "$UDID" --platform ios --bundle-id ai.yoqa.demo

# `connect` can succeed before the app's view hierarchy is readable (WDA still
# attaching, or the app not frontmost yet). Poll for the demo's own text so a
# stuck first frame fails here with diagnostics, instead of surfacing as an
# opaque 60s "Expected visible text not found" run error. Mirrors the
# uiautomator poll in ci-android.sh.
wait_for_demo_ui() {
	local attempt
	for attempt in $(seq 1 30); do
		if yoqa screen --json 2>/dev/null | grep -q "Yoqa Demo"; then
			echo "Yoqa Demo UI is visible"
			return 0
		fi
		sleep 2
	done
	return 1
}

if ! wait_for_demo_ui; then
	echo "Yoqa Demo UI never appeared (empty accessibility tree after 60s)" >&2
	trap - ERR
	capture_failure
	exit 1
fi

bash examples/expo-demo/yoqa/seed-catalog.sh
yoqa runs create DEMO --cases 1 --mode script --wait --github-output
