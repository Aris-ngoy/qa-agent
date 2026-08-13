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
}

trap capture_failure ERR

yoqa devices connect "$UDID" --platform ios --bundle-id ai.yoqa.demo
bash examples/expo-demo/yoqa/ci-smoke.sh
