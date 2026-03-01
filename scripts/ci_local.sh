#!/usr/bin/env bash

set -euo pipefail

BACKEND_ONLY=0
FRONTEND_ONLY=0
SKIP_E2E=0
SKIP_NPM_CI=0

usage() {
  cat <<'EOF'
Usage: bash scripts/ci_local.sh [options]

Options:
  --backend-only   Run only backend gates.
  --frontend-only  Run only frontend gates.
  --skip-e2e       Skip frontend Playwright e2e step.
  --skip-npm-ci    Skip npm ci step for frontend.
  -h, --help       Show this help message.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-only)
      BACKEND_ONLY=1
      shift
      ;;
    --frontend-only)
      FRONTEND_ONLY=1
      shift
      ;;
    --skip-e2e)
      SKIP_E2E=1
      shift
      ;;
    --skip-npm-ci)
      SKIP_NPM_CI=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ${BACKEND_ONLY} -eq 1 && ${FRONTEND_ONLY} -eq 1 ]]; then
  echo "Cannot combine --backend-only and --frontend-only" >&2
  exit 2
fi

run_backend=1
run_frontend=1
if [[ ${BACKEND_ONLY} -eq 1 ]]; then
  run_frontend=0
fi
if [[ ${FRONTEND_ONLY} -eq 1 ]]; then
  run_backend=0
fi

if [[ ${run_backend} -eq 1 ]]; then
  echo "[ci_local] backend: pytest"
  python -m pytest -q backend/tests -k "not repo_main_prints_backend_hint and not frontend_build_succeeds"

  echo "[ci_local] backend: ruff"
  python -m ruff check backend/app backend/tests backend/scripts

  echo "[ci_local] backend: mypy"
  python -m mypy backend/app

  echo "[ci_local] backend: perf smoke"
  python backend/scripts/run_perf_baseline.py \
    --runs-per-scenario 1 \
    --concurrency 1 \
    --soak-seconds 0 \
    --output artifacts/perf/local_ci_perf_smoke.json
fi

if [[ ${run_frontend} -eq 1 ]]; then
  if [[ ${SKIP_NPM_CI} -eq 0 ]]; then
    echo "[ci_local] frontend: npm ci"
    npm ci --prefix frontend
  fi

  echo "[ci_local] frontend: vitest"
  npm run test --prefix frontend

  echo "[ci_local] frontend: build"
  npm run build --prefix frontend

  if [[ ${SKIP_E2E} -eq 0 ]]; then
    echo "[ci_local] frontend: playwright install chromium"
    if [[ "$(uname -s)" == "Linux" ]]; then
      npx --prefix frontend playwright install --with-deps chromium
    else
      npx --prefix frontend playwright install chromium
    fi
    echo "[ci_local] frontend: e2e"
    npm run test:e2e --prefix frontend
  fi
fi

echo "[ci_local] done"

