#!/usr/bin/env bash
# Claude Code PostToolUse hook: 編集されたファイルに品質ゲートを適用する。
# - アーキテクチャ適応度関数 (ast-grep + eslint 依存方向)
# - lint (eslint / hlint + fourmolu)
# - テスト (vitest related / cabal test)
# stdin に hook payload (JSON) を受け取り、違反があれば exit 2 で編集をブロックする。
set -uo pipefail

payload="$(cat)"
file_path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')"

[ -z "$file_path" ] && exit 0
[ -f "$file_path" ] || exit 0

repository_root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$repository_root"

violations=""

append_violation() {
  violations="${violations}
== $1 ==
$2"
}

run_frontend_checks() {
  local ast_grep_binary="$repository_root/node_modules/@ast-grep/cli/ast-grep"
  [ -x "$ast_grep_binary" ] || ast_grep_binary="$(command -v ast-grep || true)"

  if [ -n "$ast_grep_binary" ]; then
    local ast_grep_output
    if ! ast_grep_output="$("$ast_grep_binary" scan "$file_path" 2>&1)"; then
      append_violation "architecture fitness (ast-grep)" "$ast_grep_output"
    fi
  fi

  local eslint_output
  if ! eslint_output="$(pnpm --filter @native-trace/frontend exec eslint --no-warn-ignored "$file_path" 2>&1)"; then
    append_violation "lint (eslint)" "$eslint_output"
  fi

  local test_output
  case "$file_path" in
    *.test.ts | *.test.tsx)
      if ! test_output="$(pnpm --filter @native-trace/frontend exec vitest run "$file_path" 2>&1)"; then
        append_violation "test (vitest)" "$test_output"
      fi
      ;;
    *)
      if ! test_output="$(pnpm --filter @native-trace/frontend exec vitest related --run "$file_path" 2>&1)"; then
        append_violation "test (vitest related)" "$test_output"
      fi
      ;;
  esac
}

run_backend_checks() {
  local backend_directory="$repository_root/applications/backend"

  local fourmolu_binary
  fourmolu_binary="$(command -v fourmolu || true)"
  [ -z "$fourmolu_binary" ] && [ -x "$HOME/.cabal/bin/fourmolu" ] && fourmolu_binary="$HOME/.cabal/bin/fourmolu"
  if [ -n "$fourmolu_binary" ]; then
    local fourmolu_output
    # --ghc-opt -XImportQualifiedPost: fourmolu は .cabal の exposed-modules/other-modules に
    # 登録済みのモジュールからのみ default-language(GHC2024)/default-extensions を抽出する。
    # 新規 .hs はまだ cabal 未登録のため抽出に乗らず、GHC2024 由来の ImportQualifiedPost が
    # 効かず postpositive `import X qualified` が parse error になる (FC-1)。
    # cabal default-language = GHC2024 と整合させるためフラグで明示的に拡張を渡す。
    # 登録済みファイルでは挙動不変 (exit-code diff 0 を全 .hs で確認済み)。
    if ! fourmolu_output="$(cd "$backend_directory" && "$fourmolu_binary" --ghc-opt -XImportQualifiedPost --mode check "$file_path" 2>&1)"; then
      append_violation "format (fourmolu)" "$fourmolu_output"
    fi
  fi

  local hlint_binary
  hlint_binary="$(command -v hlint || true)"
  [ -z "$hlint_binary" ] && [ -x "$HOME/.cabal/bin/hlint" ] && hlint_binary="$HOME/.cabal/bin/hlint"
  if [ -n "$hlint_binary" ]; then
    local hlint_output
    if ! hlint_output="$(cd "$backend_directory" && "$hlint_binary" "$file_path" 2>&1)"; then
      append_violation "lint (hlint)" "$hlint_output"
    fi
  fi

  local cabal_output
  if ! cabal_output="$(cd "$backend_directory" && cabal test all 2>&1 | tail -30; exit "${PIPESTATUS[0]}")"; then
    append_violation "test (cabal test)" "$cabal_output"
  fi
}

case "$file_path" in
  # bash の case では * が / もまたぐ
  "$repository_root"/applications/frontend/src/*.ts | "$repository_root"/applications/frontend/src/*.tsx)
    run_frontend_checks
    ;;
  "$repository_root"/applications/backend/src/*.hs | \
    "$repository_root"/applications/backend/app/*.hs | \
    "$repository_root"/applications/backend/test/*.hs)
    run_backend_checks
    ;;
  *) exit 0 ;;
esac

if [ -n "$violations" ]; then
  {
    echo "品質ゲート違反があります。修正してください:"
    echo "$violations"
  } >&2
  exit 2
fi

exit 0
