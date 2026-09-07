#!/bin/sh
set -eu
task_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$task_dir/scripts/ensure-node.sh"
exec "$task_node" "$task_dir/src/chat-storage.cjs" "$@"
