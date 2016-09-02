#!/usr/bin/env bash

set -euxo pipefail

cd "$(dirname "$0")/.."
export PATH="$PWD/node_modules/.bin:$PATH"

eslint .
mocha ./test/*.js
nsp check --output summary
