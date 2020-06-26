#!/bin/sh

set -e

if ! which -- "${1}"; then
  # first arg is not an executable
  xvfb-run -a --server-args="-screen 0 1024x768x24" -- node /app/ "$@"
  exit $?
fi

exec "$@"
