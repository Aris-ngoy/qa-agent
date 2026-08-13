#!/usr/bin/env bash
# Device-connector smoke for the Yoqa Expo demo. Requires an active
# `yoqa devices connect` session. No AI provider.
set -euo pipefail

yoqa assert visible -t "Yoqa Demo" --timeout 60
yoqa action tap --label "Increment"
yoqa assert visible -t "Count: 1" --timeout 15
yoqa action tap --label "Open greeting"
yoqa action tap --label "Name"
yoqa action input --text "Ada"
yoqa action tap --label "Submit"
yoqa assert visible -t "Hello, Ada" --timeout 15

echo "yoqa expo-demo smoke passed"
