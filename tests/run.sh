#!/bin/sh
# Run every pure-logic test. Needs Node 22.7 or newer (it reads .js files with import/export).
cd "$(dirname "$0")" && for t in *.test.mjs; do echo "== $t"; node "$t" || exit 1; done
