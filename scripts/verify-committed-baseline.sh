#!/usr/bin/env bash
# agent-policy: pinned baseline/fixture の「committed/index 値」が live 値であることを強制する。
#
# 防ぐ事故 (incident 2026-06-20 drift-stage3 / memory verify-scripts-skip-untracked / v2 migration-未生成):
#   acceptance sim が manifest を patch して `git checkout -- <file>` で cleanup すると、
#   restore 先は INDEX 版 (staged があれば staged、無ければ HEAD)。re-pin を「未コミットの
#   working-tree 編集」だけで行うと、この cleanup が再 pin を黙って巻き戻す。
#   結果: working-tree sim は緑だが、COMMITTED artifact は placeholder のまま (fresh clone で壊れる)。
#
# KEY INSIGHT: `git checkout -- <file>` は INDEX 版を復元する。だから「実際に復元される版」を
#   検査する: tracked なら `git show :<file>` (index)、staged が無ければ `git show HEAD:<file>`。
#   UNTRACKED なファイルは index entry を持たず、その re-pin は純 working-tree なので checkout で消える。
#
# Check A (pinned baseline に placeholder が committed されていないか):
#   in-scope fixture の committed/index 値 (pinned フィールド) が placeholder token
#   (TODO|DUMMY|PLACEHOLDER|first-run|replace with) を含んだら FAIL。
#   committed pin は決して placeholder であってはならない。
# Check B (re-pin/impl が純 working-tree でないか):
#   wiring-map.json が re-pin / real_entrypoint impl target と宣言したファイルが UNTRACKED なら FAIL
#   ("git checkout would wipe it; stage or commit it")。drift-stage3 の「core files UNTRACKED at HEAD」穴を塞ぐ。
#
# scope は NARROW (false-positive=rollback target):
#   - 既定の pinned-baseline fixture = applications/python-analyzer/test/fixtures/corpus/manifest.json
#   - .agent-evidence/wiring-map.json が re-pin / real_entrypoint impl と宣言したファイル
#
# default モードは他の verify-*.sh と同じく working-tree-aware (verify-scripts-skip-untracked 修正と一貫)。
# in-scope fixture が無い / 全て committed-with-live-values なら exit 0。
set -euo pipefail

repository_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$repository_root"

# 既定の pinned-baseline fixture (NARROW scope)。
PINNED_FIXTURES=(
  "applications/python-analyzer/test/fixtures/corpus/manifest.json"
)

# placeholder token (committed pin に現れてはならない)。
placeholder_re='TODO|DUMMY|PLACEHOLDER|first-run|replace with'

# wiring-map.json が re-pin / real_entrypoint impl target と宣言したファイルを取り出す。
# 「再 pin / 実装 target」と判断する条件: file パスを含む change エントリで、
#   - reachable_from / note / symbol / defect_fixed のどこかに re-pin / baseline / pin の語がある、または
#   - top-level real_entrypoints がそのファイルを baseline 更新 entrypoint として挙げている。
# evidence dir のルート wiring-map.json と各 feature サブディレクトリの wiring-map.json を見る。
collect_wiringmap_repin_targets() {
  local maps=()
  [ -f .agent-evidence/wiring-map.json ] && maps+=(".agent-evidence/wiring-map.json")
  while IFS= read -r m; do
    [ -n "$m" ] && maps+=("$m")
  done < <(find .agent-evidence -mindepth 2 -name wiring-map.json 2>/dev/null)
  local m
  for m in "${maps[@]}"; do
    [ -f "$m" ] || continue
    if command -v jq >/dev/null 2>&1; then
      # changes[] のうち re-pin / baseline / pin を含意するエントリの file (":line" suffix を剥がす)。
      jq -r '
        ((.changes // [])[]
          | select(
              ((.note // "") + " " + (.symbol // "") + " " + (.reachable_from // "") + " " + (.defect_fixed // ""))
              | test("re-pin|re pin|repin|baseline|\\bpin\\b"; "i"))
          | .file)
        // empty
      ' "$m" 2>/dev/null | sed 's/:[0-9].*$//' || true
    fi
  done | sort -u
}

failures=""

# ---- Check A: committed/index pinned baseline must not be a placeholder ----
# committed/index 版を取り出す。staged があれば staged (index)、無ければ HEAD。
committed_blob() { # $1=file -> stdout committed/index content (empty if none)
  local f="$1"
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    # tracked: index 版 (staged 差分があればそれ、無ければ HEAD と同じ)。これが git checkout 復元先。
    git show ":$f" 2>/dev/null || git show "HEAD:$f" 2>/dev/null || true
  else
    # untracked: index entry なし。committed 版は存在しない (Check B 側で扱う)。
    return 0
  fi
}

scan_pinned_placeholders() { # $1=file  reads committed blob, FAILs if pinned values carry placeholder tokens
  local f="$1" blob
  blob="$(committed_blob "$f")"
  [ -z "$blob" ] && return 0

  if command -v jq >/dev/null 2>&1 && printf '%s' "$blob" | jq -e . >/dev/null 2>&1; then
    # corpus-manifest: pinned 値だけを抽出して検査 (ドキュメント _comment は対象外 → FP 回避)。
    # entries[].observed.{analyzerCommit, gop.band, topNBest.phonemes[]} と
    # entries[].aPriori.{expectedReferenceIpa, expectedCatalogId, expectedPhenomenon} を走査する。
    local pinned_values
    pinned_values="$(printf '%s' "$blob" | jq -r '
      [ (.entries // [])[]
        | ( .observed.analyzerCommit // empty ),
          ( (.observed.gop.band // {}) | (.. | strings) ),
          ( (.observed.topNBest.phonemes // []) | .[] ),
          ( .aPriori.expectedReferenceIpa // empty ),
          ( .aPriori.expectedCatalogId // empty ),
          ( .aPriori.expectedPhenomenon // empty )
      ] | .[]' 2>/dev/null || true)"
    local hit
    hit="$(printf '%s\n' "$pinned_values" | grep -niE "$placeholder_re" || true)"
    if [ -n "$hit" ]; then
      failures="${failures}== $f (committed/index pinned value carries placeholder) ==
${hit}
"
    fi
  else
    # 非 JSON / jq 無し fallback: pinned フィールドっぽい value 行のみ走査
    # (_comment / _calibrationNote / _schema / _ 始まりの doc key 行は除外して FP を抑える)。
    local hit
    hit="$(printf '%s' "$blob" | grep -nE '"(analyzerCommit|phonemes|band|expectedReferenceIpa|expectedCatalogId|expectedPhenomenon|min|max)"' \
            | grep -iE "$placeholder_re" || true)"
    if [ -n "$hit" ]; then
      failures="${failures}== $f (committed/index pinned value carries placeholder) ==
${hit}
"
    fi
  fi
}

for f in "${PINNED_FIXTURES[@]}"; do
  [ -e "$f" ] || git ls-files --error-unmatch "$f" >/dev/null 2>&1 || continue
  scan_pinned_placeholders "$f"
done

# ---- Check B: wiring-map が re-pin/impl と宣言した file が untracked なら git checkout で消える ----
while IFS= read -r target; do
  [ -z "$target" ] && continue
  # 存在しないパスは無視 (誤宣言を gate の対象にしない)。
  [ -e "$target" ] || continue
  if ! git ls-files --error-unmatch "$target" >/dev/null 2>&1; then
    failures="${failures}== $target (re-pin/impl file UNTRACKED) ==
wiring-map.json がこのファイルを re-pin / real_entrypoint 実装 target と宣言していますが、
git に追跡されていません。\`git checkout -- <file>\` cleanup を回す sim はこの再 pin を巻き戻します。
先に git add で stage する (または commit する) こと。
"
  fi
done < <(collect_wiringmap_repin_targets)

if [ -n "$failures" ]; then
  echo "POLICY VIOLATION: committed baseline carries placeholder / re-pin would be wiped by git checkout." >&2
  printf '%s' "$failures" >&2
  echo "" >&2
  echo "対処:" >&2
  echo "  - committed pin が placeholder の場合: 実測値で re-pin し、必ず stage/commit してから sim を回す。" >&2
  echo "  - re-pin/impl が untracked の場合: git add で stage する。git checkout cleanup を使うなら HEAD/index が live 値を持つこと。" >&2
  echo "  - cp-backup restore (cp <f> <f>.bak / 復元) を使えば working-tree-only の再 pin も保持できる。" >&2
  exit 1
fi

echo "verify-committed-baseline: OK"
