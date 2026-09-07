#!/bin/sh
set -eu
task_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$task_dir/chat-storage.cjs" "$@"
