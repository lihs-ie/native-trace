#!/usr/bin/env bash
# agent-policy: 本番 src/ から test/fullcycle/ または test/selfeval/ への import を禁止する。
# ADR-031 D7 / M-FCH-8: harness/fixture 層を本番コードから分離する機械強制。
set -euo pipefail

repository_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$repository_root"

src_dir="applications/frontend/src"

# grep -r で全 .ts/.tsx を検索 (src/ 配下のみ)
hits="$(grep -rn 'test/fullcycle\|test/selfeval' "${src_dir}" --include="*.ts" --include="*.tsx" 2>/dev/null || true)"

if [ -n "$hits" ]; then
  echo "POLICY VIOLATION: production src/ imports test/fullcycle or test/selfeval harness code." >&2
  echo "Hits:" >&2
  echo "$hits" >&2
  echo "" >&2
  echo "harness/fixture コードはテストスコープ専用です (ADR-031 D7)。" >&2
  exit 1
fi

echo "no-harness-import-in-prod: OK"
