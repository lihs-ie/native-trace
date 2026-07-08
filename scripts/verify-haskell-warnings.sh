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

# 全 *.cabal に必須: partial record construction を build error 化する (incident 2026-06-13)。
required_flags='-Werror=missing-fields'
# worker cabal に必須: 「計算したが construction site で使われない let/where 束縛」(dead wiring) を
#   build error 化する。-Wunused-local-binds / -Wunused-matches は -Wall に含まれるが warning 止まりで
#   cabal build/test が緑を通過する (incident 2026-06-19 ADR-018 GOP-site dead-Nothing: acousticEvidence を
#   let で計算したが construction site が literal Nothing のまま → 機能が死んでいるのに build/test 緑)。
worker_required_flags='-Werror=unused-local-binds -Werror=unused-matches'
worker_cabal='applications/backend/native-trace-worker.cabal'
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
  for flag in $required_flags; do
    if ! grep -qF -- "$flag" "$cabal"; then
      missing="${missing}  $cabal (ghc-options に $flag が無い)
"
    fi
  done
done <<< "$cabal_files"

# worker cabal だけに課す unused-binds/unused-matches 系 (dead wiring 防止)。
if [ -f "$worker_cabal" ]; then
  for flag in $worker_required_flags; do
    if ! grep -qF -- "$flag" "$worker_cabal"; then
      missing="${missing}  $worker_cabal (ghc-options に $flag が無い)
"
    fi
  done
fi

if [ -n "$missing" ]; then
  echo "POLICY VIOLATION: cabal warning 設定に必須 flag がありません。" >&2
  printf '%s' "$missing" >&2
  echo "common warnings (または各 ghc-options) に上記 flag を追加してください。" >&2
  echo "理由: -Werror=missing-fields はレコードフィールド追加時の builder 漏れ (partial record construction) を," >&2
  echo "      -Werror=unused-local-binds / -Werror=unused-matches は計算したが construction site で使われない" >&2
  echo "      let/where 束縛 (dead wiring) を build error 化します。どちらも warning 止まりだと build/test 緑を" >&2
  echo "      通過し runtime で死にます (前者: thunk crash / 後者: literal Nothing で機能が死ぬ)。" >&2
  exit 1
fi
echo "verify-haskell-warnings: OK"
