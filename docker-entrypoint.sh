#!/bin/sh

set -e

if ! which -- "${1}"; then
  # first arg is not an executable
  xvfb-run --server-args="-screen 0 1024x768x24" -- node /app/ "$@"
  exit $?
fi

exec "$@"
