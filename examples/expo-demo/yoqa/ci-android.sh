#!/usr/bin/env bash
# Install the Expo demo on the booted emulator and run the Yoqa smoke.
# Invoked from GitHub Actions via `bash` (android-emulator-runner uses /bin/sh).
set -euo pipefail

SERIAL="$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
if [ -z "$SERIAL" ]; then
	echo "No Android emulator serial found" >&2
	adb devices -l >&2 || true
	exit 1
fi

# Expo --device matches AVD name (`adb emu avd name`), not the adb serial.
AVD_NAME="$(adb -s "$SERIAL" emu avd name | head -n 1 | tr -d '\r')"
if [ -z "$AVD_NAME" ]; then
	echo "Could not read AVD name for ${SERIAL}" >&2
	adb devices -l >&2 || true
	exit 1
fi

echo "Using Android device ${SERIAL} (AVD ${AVD_NAME})"
adb devices -l
(
	cd examples/expo-demo
	npx expo run:android --variant release --no-bundler --device "$AVD_NAME"
)
yoqa devices connect "$SERIAL" --platform android --app-package ai.yoqa.demo
bash examples/expo-demo/yoqa/ci-smoke.sh
