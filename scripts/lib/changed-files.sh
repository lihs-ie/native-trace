#!/usr/bin/env bash
# agent-policy: verify-*.sh 系 (fail-open マージゲート) が共有する
# 「どのファイルが変更されたか」収集ロジック。
#   1. 単一ファイル引数 (hook 経由): そのファイルだけを changed とする。
#   2. BASE_REF (無ければ origin/HEAD、それも無ければ origin/main) との
#      `git diff --name-only` (CI 経路)。
#   3. base ref 自体が resolve できないとき (shallow clone 等) の第一フォールバック。
#      呼び出し元ごとに元の実装が異なるため、その差はそのまま
#      collect_changed_files の第 2 引数で温存する (意味は変えない):
#        - "ls-files" (default): HEAD~1 diff が失敗したら `git ls-files` で全ファイル扱い
#        - "empty":              HEAD~1 diff が失敗したら空のまま次段 (4) へ委ねる
#   4. base 比較の結果が空 (= コミット済み diff が base に対して無い) の場合、working-tree
#      フォールバック (git diff HEAD + untracked) で「未コミットの作業を空振りさせない」
#      (2026-06-18 の「untracked 空振り」インシデントの恒久対策。CI は常に committed diff が
#      あるためこの分岐は CI 上は無害)。
#
# source 専用。単体実行は想定しない。呼び出し元スクリプトは `set -euo pipefail` 済みの前提。

test_dir_re='(^|/)(test|tests|__tests__|spec|specs|fixtures|testdata|mocks?|stubs?|fakes?)(/|$)'
code_ext_re='\.(ts|tsx|js|jsx|mjs|cjs|go|php|py|rb|java|kt|kts|hs|rs|scala|swift|c|cc|cpp|h|hpp)$'

# collect_changed_files [single_file] [base_missing_fallback]
#   single_file:           hook から渡された 1 ファイル (指定時はこれを changed として即返す)
#   base_missing_fallback: "ls-files" (default) | "empty" — 上記 3. 参照
# 常に stdout へ改行区切りでファイル一覧を出す (呼び出し元は $(...) で受ける)。
collect_changed_files() {
  local single_file="${1:-}"
  local base_missing_fallback="${2:-ls-files}"
  local base changed

  if [ -n "$single_file" ]; then
    printf '%s\n' "$single_file"
    return 0
  fi

  base="${BASE_REF:-$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@refs/remotes/@@')}"
  [ -z "${base:-}" ] && base="origin/main"
  if git rev-parse --verify "$base" >/dev/null 2>&1; then
    changed="$(git diff --name-only --diff-filter=ACMRT "$base"...HEAD)"
  elif [ "$base_missing_fallback" = "empty" ]; then
    changed="$(git diff --name-only --diff-filter=ACMRT HEAD~1 2>/dev/null || true)"
  else
    changed="$(git diff --name-only --diff-filter=ACMRT HEAD~1 2>/dev/null || git ls-files)"
  fi
  if [ -z "$changed" ]; then
    # no committed diff vs base — fall back to working-tree changes so uncommitted/untracked
    # work is not vacuously passed (CI always has a committed diff, so this branch is CI-inert).
    changed="$(git diff --name-only --diff-filter=ACMRT HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null)"
  fi
  printf '%s\n' "$changed"
}
