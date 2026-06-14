#!/usr/bin/env bash
# agent-policy: PostToolUse(Write|Edit) hook。編集された 1 ファイルに対し
# no-prod-doubles / test-bypass を即時チェックし、違反なら exit 2 で編集をブロックする。
# 既存の fitness hook (scripts/fitness/hook.sh) とは独立に、追加 hook として共存させる。
set -uo pipefail

payload="$(cat)"
file_path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
[ -z "$file_path" ] && exit 0
[ -f "$file_path" ] || exit 0

repository_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$repository_root"

# repo-relative path に変換 (allowlist の glob と整合させる)
rel="${file_path#"$repository_root"/}"

violations=""
for script in scripts/verify-no-prod-doubles.sh scripts/verify-test-bypass.sh; do
  [ -x "$script" ] || [ -f "$script" ] || continue
  if ! out="$(bash "$script" "$rel" 2>&1)"; then
    violations="${violations}
== ${script##*/} ==
$out"
  fi
done

# *.cabal を編集したら cabal warning 設定の硬さ (-Werror=missing-fields) を repo 全体で検査する。
# verify-haskell-warnings.sh は単一ファイル引数ではなく tree 全体を検査する設計のため、
# トリガーは「編集ファイルが *.cabal か否か」で判定する。
case "$rel" in
  *.cabal)
    if [ -f scripts/verify-haskell-warnings.sh ]; then
      if ! out="$(bash scripts/verify-haskell-warnings.sh 2>&1)"; then
        violations="${violations}
== verify-haskell-warnings.sh ==
$out"
      fi
    fi
    ;;
esac

# Servant の Api.hs (route 型) / Application.hs (handler 結線) を編集したら
# route 数 ↔ handler 数の parity を tree 全体で検査する (FC-2)。
# verify-servant-route-handler-parity.sh は単一ファイル引数ではなく両ファイルを常に読む設計のため、
# トリガーは「編集ファイルが Api.hs / Application.hs か否か」で判定する。
case "$rel" in
  applications/backend/src/NativeTrace/Worker/Api.hs | \
    applications/backend/src/NativeTrace/Worker/Application.hs)
    if [ -f scripts/verify-servant-route-handler-parity.sh ]; then
      if ! out="$(bash scripts/verify-servant-route-handler-parity.sh 2>&1)"; then
        violations="${violations}
== verify-servant-route-handler-parity.sh ==
$out"
      fi
    fi
    ;;
esac

if [ -n "$violations" ]; then
  {
    echo "agent-policy 違反があります。修正してください:"
    echo "$violations"
  } >&2
  exit 2
fi
exit 0
