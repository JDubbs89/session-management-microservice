#!/usr/bin/env bash
set -euo pipefail

compose_file="$(cd -- "$(dirname -- "$0")" && pwd)/docker-compose.yml"
example=trivia
if [[ "${1:-}" == "--directory-example" ]]; then
  example=directory
  shift
elif [[ "${1:-}" == --* ]]; then
  printf 'Unknown option: %s\nUsage: %s [--directory-example]\n' "$1" "$0" >&2
  exit 2
fi

if [[ $# -gt 0 ]]; then
  printf 'Unexpected argument: %s\nUsage: %s [--directory-example]\n' "$1" "$0" >&2
  exit 2
fi
EXAMPLE="$example" docker compose -f "$compose_file" up --build -d --wait
printf 'Open http://127.0.0.1:%s\n' "${DEMO_PORT:-3000}"
