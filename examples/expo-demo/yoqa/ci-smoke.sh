#!/usr/bin/env bash
# Device-connector smoke for the Yoqa Expo demo. Requires an active
# `yoqa devices connect` session. No AI provider.
# After every yoqa action (and each assert), write a PNG under
# $YOQA_SMOKE_SHOTS (default: artifacts/screenshots).
set -euo pipefail

SHOT_DIR="${YOQA_SMOKE_SHOTS:-artifacts/screenshots}"
mkdir -p "$SHOT_DIR"
step=0

shot() {
	step=$((step + 1))
	local name
	printf -v name '%02d-%s.png' "$step" "$1"
	yoqa screenshot "$SHOT_DIR/$name"
}

yoqa assert visible -t "Yoqa Demo" --timeout 60
shot home
yoqa action tap --label "Increment"
shot after-increment
yoqa assert visible -t "Count: 1" --timeout 15
shot count-1
yoqa action tap --label "Open greeting"
shot greeting
yoqa action tap --label "Name"
shot name-focused
yoqa action input --text "Ada"
shot name-typed
yoqa action tap --label "Submit"
shot submitted
yoqa assert visible -t "Hello, Ada" --timeout 15
shot hello-ada

echo "yoqa expo-demo smoke passed (${step} screenshots in ${SHOT_DIR})"
