#!/usr/bin/env bash
# Install the pinned facebook/idb release where the runner looks for it (~/.yoqa/idb):
# the companion binary from the GitHub release (not the Homebrew facebook/fb tap) and the
# `fb-idb` client in a venv. The iOS simulator Direct lane needs both.
set -euo pipefail

VERSION="1.6.5"
COMPANION_SHA256="bf7aff1e26a3f56a09f376cb4733d17cc139db7988ce00c0a9b058b3d3a7843c"
CLIENT_WHEEL="fb_idb-${VERSION}-py3-none-any.whl"
CLIENT_SHA256="994a2e33cb7cff81438e431ffe634b1320153d95761119805cdc7e7342579f75"
# The client's dependencies, pinned to the versions it was checked with.
CLIENT_DEPS=(aiofiles==25.1.0 grpclib==0.4.9 protobuf==7.36.2)

DEST="${YOQA_IDB_HOME:-$HOME/.yoqa/idb}"
PYTHON="${PYTHON:-python3}"
BASE="https://github.com/facebook/idb/releases/download/v${VERSION}"

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
	echo "install-idb: the idb_companion ${VERSION} release is macOS arm64 only" >&2
	exit 1
fi

if [ -x "$DEST/idb_companion" ] && [ -x "$DEST/venv/bin/idb" ]; then
	echo "idb ${VERSION} already installed in $DEST"
	"$DEST/idb_companion" --version
	exit 0
fi

if ! "$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
	echo "install-idb: fb-idb needs Python 3.10+ (got $("$PYTHON" --version 2>&1))" >&2
	exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL --retry 3 -o "$TMP/companion.tar.gz" "$BASE/idb-companion.macos-arm64.tar.gz"
echo "${COMPANION_SHA256}  $TMP/companion.tar.gz" | shasum -a 256 -c - >/dev/null
curl -fsSL --retry 3 -o "$TMP/$CLIENT_WHEEL" "$BASE/$CLIENT_WHEEL"
echo "${CLIENT_SHA256}  $TMP/$CLIENT_WHEEL" | shasum -a 256 -c - >/dev/null

mkdir -p "$DEST"
tar -xzf "$TMP/companion.tar.gz" -C "$DEST"
"$PYTHON" -m venv "$DEST/venv"
"$DEST/venv/bin/pip" install --quiet --disable-pip-version-check "$TMP/$CLIENT_WHEEL" "${CLIENT_DEPS[@]}"

"$DEST/idb_companion" --version
"$DEST/venv/bin/idb" --help >/dev/null
echo "Installed idb ${VERSION} in $DEST"
