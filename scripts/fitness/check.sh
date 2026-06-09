#!/usr/bin/env bash
# アーキテクチャ適応度関数の一括実行（CI / 手動用）。
# - ast-grep: レイヤー純粋性・ライブラリ閉じ込めルール (.ast-grep/rules/)
# - eslint:   オニオン層の依存方向 (import/no-restricted-paths)
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

ast_grep_binary="$repository_root/node_modules/@ast-grep/cli/ast-grep"
if [ ! -x "$ast_grep_binary" ]; then
  ast_grep_binary="$(command -v ast-grep || true)"
fi
if [ -z "$ast_grep_binary" ]; then
  echo "ast-grep not found. Run 'pnpm install' first." >&2
  exit 1
fi

echo "== fitness: ast-grep scan =="
"$ast_grep_binary" scan

echo "== fitness: eslint (dependency direction) =="
pnpm --filter @native-trace/frontend lint

echo "== fitness: OK =="
