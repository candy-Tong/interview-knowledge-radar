#!/usr/bin/env bash

set -euo pipefail

if ! command -v llama-server >/dev/null 2>&1; then
  echo "llama-server was not found. Install it with: brew install llama.cpp" >&2
  exit 1
fi

question_model_repo="${QUESTION_MODEL_REPO:-unsloth/Qwen3.5-2B-GGUF:Q4_K_M}"
question_model_alias="${LOCAL_QUESTION_MODEL:-qwen3.5-2b}"
question_model_port="${QUESTION_MODEL_PORT:-18080}"

exec llama-server \
  --hf-repo "$question_model_repo" \
  --no-mmproj \
  --alias "$question_model_alias" \
  --host 127.0.0.1 \
  --port "$question_model_port" \
  --cors-origins localhost \
  --ctx-size 4096 \
  --parallel 1 \
  --reasoning off \
  --no-webui
