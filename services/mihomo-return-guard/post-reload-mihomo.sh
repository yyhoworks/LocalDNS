#!/bin/sh
set -eu
# The same lock and validation are used by the reload hook and background guard.
exec /usr/bin/python3 /usr/local/sbin/mihomo-return-guard.py --ensure --wait 15
