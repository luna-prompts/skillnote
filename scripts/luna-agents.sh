#!/usr/bin/env sh
# Run from any working directory. Requires Node >=20.12 and npm.
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"
if [ "$#" -eq 0 ]; then
  set -- sync
fi
exec npx --yes --package=@agents-dev/cli@0.9.2 agents "$@"
