#!/usr/bin/env bash
# KIT_VERSION: 1.3.0
# agent-policy: 本番経路に test-only bypass が無いか検出する。
# 例: if (process.env.NODE_ENV === 'test') return fake; / NODE_ENV==='test' 分岐 /
#     APP_ENV == "test" / isTest ショートサーキット / Haskell の isTestEnv 分岐。
# テスト系ディレクトリは除外。
set -euo pipefail

repository_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$repository_root"

source "$repository_root/scripts/lib/changed-files.sh"

changed="$(collect_changed_files "${1:-}")"

prod_changed="$(printf '%s\n' "$changed" | grep -Evi "$test_dir_re" | grep -Ei "$code_ext_re" || true)"

# 本番経路の迂回パターン。設定読み込みそのもの (config 層) は別ルールで管理するため、
# ここでは「'test' 値との比較で分岐する」ことに絞る。
bypass_re="(NODE_ENV|APP_ENV|RAILS_ENV|GO_ENV|ENV)[^=]*={2,3}[[:space:]]*['\"]test['\"]|['\"]test['\"][[:space:]]*={2,3}[^=]*(NODE_ENV|APP_ENV|ENV)|\bisTest(Env)?\b[[:space:]]*(\?|&&|\|\||\))|if[[:space:]]+isTestEnv"

hits=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ -f "$f" ] || continue
  out="$(grep -nEi "$bypass_re" "$f" 2>/dev/null || true)"
  [ -n "$out" ] && hits="${hits}== $f ==
$out
"
done <<< "$prod_changed"

if [ -n "$hits" ]; then
  echo "POLICY VIOLATION: test-only bypass detected in production path." >&2
  printf '%s' "$hits" >&2
  echo "本番経路を 'test' 環境で迂回しないでください。設定差は config 層に閉じ込めること。" >&2
  exit 1
fi
echo "no-test-bypass: OK"
