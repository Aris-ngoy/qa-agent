#!/usr/bin/env bash
# Install the Expo demo on the booted emulator and run the Yoqa smoke.
# Invoked from GitHub Actions via `bash` (android-emulator-runner uses /bin/sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

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

capture_failure() {
	mkdir -p artifacts
	{
		echo "=== window focus ==="
		adb -s "$SERIAL" shell dumpsys window 2>/dev/null | awk '/mCurrentFocus|mFocusedApp/' || true
		echo "=== uiautomator dump (head) ==="
		adb -s "$SERIAL" shell uiautomator dump /sdcard/yoqa-dump.xml >/dev/null 2>&1 || true
		adb -s "$SERIAL" shell cat /sdcard/yoqa-dump.xml 2>/dev/null | head -c 8000 || true
		echo
		echo "=== logcat ReactNative / AndroidRuntime ==="
		adb -s "$SERIAL" logcat -d -t 120 -s ReactNative:V ReactNativeJS:V AndroidRuntime:E libc:F || true
	} >artifacts/android-diagnostics.txt 2>&1 || true
	yoqa screenshot artifacts/android-failure.png || true
	yoqa screen --json >artifacts/android-screen.json || true
}

trap capture_failure ERR

(
	cd examples/expo-demo
	npx expo run:android --variant release --no-bundler --device "$AVD_NAME"
)

echo "Waiting for ai.yoqa.demo to show Yoqa Demo…"
found=0
for _ in $(seq 1 60); do
	focus="$(adb -s "$SERIAL" shell dumpsys window 2>/dev/null | awk -F= '/mCurrentFocus/{print $2; exit}' || true)"
	adb -s "$SERIAL" shell uiautomator dump /sdcard/yoqa-dump.xml >/dev/null 2>&1 || true
	if adb -s "$SERIAL" shell cat /sdcard/yoqa-dump.xml 2>/dev/null | grep -q "Yoqa Demo"; then
		echo "Found Yoqa Demo (focus: ${focus})"
		found=1
		break
	fi
	sleep 2
done
if [ "$found" -ne 1 ]; then
	echo "Timed out waiting for Yoqa Demo in the view hierarchy" >&2
	exit 1
fi

yoqa devices connect "$SERIAL" --platform android --app-package ai.yoqa.demo
bash examples/expo-demo/yoqa/ci-smoke.sh
