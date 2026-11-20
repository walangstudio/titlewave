#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export TITLEWAVE_MAC_TEST_WINDOW=1
exec /usr/bin/python3 "$script_dir/macos.py"
