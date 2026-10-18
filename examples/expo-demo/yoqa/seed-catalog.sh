#!/usr/bin/env bash
# Idempotent catalog seed for the Expo demo smoke (script mode, no AI).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/examples/expo-demo/yoqa/smoke.yoqa.yaml"
# The web job serves the demo locally and passes its address; a Run on web opens it.
web_url_args=()
if [ -n "${YOQA_DEMO_WEB_URL:-}" ]; then
	web_url_args=(--web-url "$YOQA_DEMO_WEB_URL")
fi

if ! yoqa apps get DEMO >/dev/null 2>&1; then
	yoqa apps create --name "Yoqa Demo" --prefix DEMO \
		--ios-bundle-id ai.yoqa.demo \
		--android-application-id ai.yoqa.demo \
		${web_url_args[@]+"${web_url_args[@]}"}
else
	yoqa apps update DEMO \
		--ios-bundle-id ai.yoqa.demo \
		--android-application-id ai.yoqa.demo \
		${web_url_args[@]+"${web_url_args[@]}"}
fi

if ! yoqa cases get DEMO 1 >/dev/null 2>&1; then
	yoqa cases create DEMO --title "Smoke" --script-file "$SCRIPT"
else
	yoqa cases update DEMO 1 --script-file "$SCRIPT"
fi
