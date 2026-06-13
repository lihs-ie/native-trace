#!/usr/bin/env bash
# agent-policy: Haskell cabal の warning 設定に -Werror=missing-fields があるかを検査する。
# 背景: レコードにフィールドを追加し builder 側で設定し忘れると GHC -Wmissing-fields は
#   *warning 止まり* で cabal build / cabal test が緑のまま通過し、ToJSON 等で未設定フィールドの
#   bottom thunk が forced された瞬間に runtime crash する (incident 2026-06-13: worker HTTP 000)。
#   このクラスは「partial record construction を build error 化する」ことでしか静的に防げないため、
#   全 *.cabal の warning 設定に -Werror=missing-fields が含まれることを必須化する。
# 検査対象: applications/backend 配下の *.cabal すべて。1 つでも欠けていれば exit 1。
# diff 連動はしない (cabal は数が少なく常時必須にして良い設定なので、tree 全体を常に検査する)。
set -euo pipefail

repository_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$repository_root"

required_flag='-Werror=missing-fields'
backend_dir="applications/backend"

if [ ! -d "$backend_dir" ]; then
  echo "verify-haskell-warnings: $backend_dir not found (skip)"; exit 0
fi

cabal_files="$(find "$backend_dir" -name '*.cabal' -type f 2>/dev/null || true)"
if [ -z "$cabal_files" ]; then
  echo "verify-haskell-warnings: no *.cabal under $backend_dir (skip)"; exit 0
fi

missing=""
while IFS= read -r cabal; do
  [ -z "$cabal" ] && continue
  if ! grep -qF -- "$required_flag" "$cabal"; then
    missing="${missing}  $cabal (ghc-options に $required_flag が無い)
"
  fi
done <<< "$cabal_files"

if [ -n "$missing" ]; then
  echo "POLICY VIOLATION: cabal warning 設定に $required_flag がありません。" >&2
  printf '%s' "$missing" >&2
  echo "common warnings (または各 ghc-options) に $required_flag を追加してください。" >&2
  echo "理由: レコードフィールド追加時の builder 漏れ (partial record construction) は warning では" >&2
  echo "      build/test 緑を通過し、ToJSON 等の強制評価で runtime thunk crash になります。" >&2
  exit 1
fi
echo "verify-haskell-warnings: OK"
