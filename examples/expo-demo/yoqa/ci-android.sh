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

if [ -n "${YOQA_DEMO_APK:-}" ]; then
	if [ ! -f "$YOQA_DEMO_APK" ]; then
		echo "Cached APK not found: ${YOQA_DEMO_APK}" >&2
		exit 1
	fi
	echo "Installing prebuilt APK ${YOQA_DEMO_APK}"
	adb -s "$SERIAL" install -r "$YOQA_DEMO_APK"
else
	(
		cd examples/expo-demo
		npx expo run:android --variant release --no-bundler --device "$AVD_NAME"
	)
fi

adb -s "$SERIAL" shell am start -W -n ai.yoqa.demo/.MainActivity >/dev/null || true
echo "Waiting briefly for ai.yoqa.demo (Yoqa assert will wait if the dump is empty)…"
for _ in $(seq 1 30); do
	focus="$(adb -s "$SERIAL" shell dumpsys window 2>/dev/null | awk -F= '/mCurrentFocus/{print $2; exit}' || true)"
	adb -s "$SERIAL" shell uiautomator dump /sdcard/yoqa-dump.xml >/dev/null 2>&1 || true
	dump="$(adb -s "$SERIAL" shell cat /sdcard/yoqa-dump.xml 2>/dev/null || true)"
	if printf '%s' "$dump" | grep -q "Yoqa Demo"; then
		echo "Found Yoqa Demo (focus: ${focus})"
		break
	fi
	case "$dump" in
	*"isn't responding"*)
		echo "Dismissing ANR dialog"
		bounds="$(
			printf '%s' "$dump" | tr '>' '\n' | grep 'aerr_wait' |
				sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p'
		)"
		if [ -n "$bounds" ]; then
			set -- $bounds
			adb -s "$SERIAL" shell input tap $((($1 + $3) / 2)) $((($2 + $4) / 2))
		fi
		;;
	esac
	sleep 2
done

yoqa devices connect "$SERIAL" --platform android --app-package ai.yoqa.demo
bash examples/expo-demo/yoqa/seed-catalog.sh
yoqa runs create DEMO --cases 1 --mode script --wait --github-output
