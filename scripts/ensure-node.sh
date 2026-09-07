#!/bin/sh
# Sourced by run-cleaner.sh; sets task_node without changing the system runtime.
cleaner_node_works() {
    "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1
}

cleaner_install_node() (
    set -eu
    mkdir -p "$task_runtime"
    task_stage=$(mktemp -d "$task_runtime/setup-XXXXXXXX")
    trap 'rm -rf -- "$task_stage"' EXIT
    trap 'exit 1' HUP INT TERM
    task_archive="$task_name.tar.gz"
    task_url="https://nodejs.org/dist/$task_version"
    cleaner_download() {
        if command -v curl >/dev/null 2>&1; then
            curl --fail --location --proto '=https' --tlsv1.2 --output "$2" "$1"
        elif command -v wget >/dev/null 2>&1; then
            wget --https-only -O "$2" "$1"
        else
            echo 'Install curl or wget, then run the cleaner again.' >&2; return 1
        fi
    }
    echo 'Downloading Node.js and verifying its checksum...'
    cleaner_download "$task_url/$task_archive" "$task_stage/$task_archive"
    cleaner_download "$task_url/SHASUMS256.txt" "$task_stage/SHASUMS256.txt"
    task_expected=$(awk -v name="$task_archive" '$2 == name {print $1}' "$task_stage/SHASUMS256.txt")
    if command -v sha256sum >/dev/null 2>&1; then
        task_actual=$(sha256sum "$task_stage/$task_archive" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then
        task_actual=$(shasum -a 256 "$task_stage/$task_archive" | awk '{print $1}')
    else
        echo 'A SHA-256 tool (sha256sum or shasum) is required.' >&2; exit 1
    fi
    if [ ${#task_expected} -ne 64 ] || [ "$task_expected" != "$task_actual" ]; then
        echo 'Node.js checksum verification failed. Download was not installed.' >&2; exit 1
    fi
    tar -xzf "$task_stage/$task_archive" -C "$task_stage"
    if ! cleaner_node_works "$task_stage/$task_name/bin/node"; then
        echo 'Downloaded Node.js cannot run on this OS. Install a compatible Node.js 24+ from https://nodejs.org.' >&2; exit 1
    fi
    if [ -e "$task_runtime/$task_name" ]; then
        echo 'An unusable runtime already exists. Remove only that runtime folder and retry.' >&2; exit 1
    fi
    mv "$task_stage/$task_name" "$task_runtime/"
    echo 'Node.js is ready. Starting LLM Cleaner...'
)

task_node=$(command -v node || true)
if [ -z "$task_node" ] || ! cleaner_node_works "$task_node"; then
    task_version=v24.20.0
    case $(uname -s) in
        Linux) task_os=linux ;;
        Darwin) task_os=darwin ;;
        *) echo 'Automatic setup supports Linux and macOS. Install Node.js 24+ manually.' >&2; exit 1 ;;
    esac
    case $(uname -m) in
        x86_64|amd64) task_arch=x64 ;;
        aarch64|arm64) task_arch=arm64 ;;
        *) echo 'Automatic setup supports x64 and ARM64. Install Node.js 24+ manually.' >&2; exit 1 ;;
    esac
    task_runtime="${XDG_DATA_HOME:-$HOME/.local/share}/llm-cleaner/runtime"
    task_name="node-$task_version-$task_os-$task_arch"
    task_node="$task_runtime/$task_name/bin/node"
    if ! cleaner_node_works "$task_node"; then
        echo "Node.js 24+ is missing or too old. Download Node.js $task_version from nodejs.org?"
        echo "Installed only for this cleaner in $task_runtime. No sudo or system Node.js changes."
        if [ ! -t 0 ]; then
            echo 'Run interactively to approve installation, or install Node.js 24+ yourself.' >&2; exit 1
        fi
        printf 'Download and install Node.js now? [y/N] '
        read -r task_consent || task_consent=''
        case $task_consent in
            y|Y|yes|YES|Yes) cleaner_install_node ;;
            *) echo 'Node.js installation cancelled. No download was started.' >&2; exit 1 ;;
        esac
    fi
fi
