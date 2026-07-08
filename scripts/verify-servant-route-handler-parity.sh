#!/usr/bin/env bash
# agent-policy: Servant の WorkerApi 型 (Api.hs) の route 数と
# Application.hs の server combinator (handler) 数が一致するかを検査する。
#
# 背景 (FC-2): implementer が Api.hs の `type WorkerApi =` に route を追加しても
#   Application.hs の `server = ... :<|> ...` に handler を結線せず早期終了する再発があった。
#   Servant では route 数と handler 数が一致しないと型エラーになるので「最終的には」コンパイルで
#   守られるが、implementer が build を回さず終了メッセージで「次に handler を足す」と宣言したまま
#   去ると、未配線のまま done 報告される (wiring_manifest.yml の backend-servant-route-needs-handler は
#   co-change の有無しか見ず、route 数 ↔ handler 数の parity は見ない)。
#   このスクリプトは compile を待たずに静的な数合わせで未配線を即座に検出する補完ゲート。
#
# 数え方:
#   route 数  = `type WorkerApi =` ブロック内の HTTP method combinator
#               (Get|Post|Put|Delete|Patch) の出現数。各 route はちょうど 1 つ持つ。
#   handler 数 = `server = ...` 定義ブロック内のトップレベル `:<|>` の出現数 + 1。
#               (型シグネチャ `server :: Server WorkerApi` と import の `(:<|>)` は対象外)
#
# 不一致なら exit 1。tree 全体を常時検査する (co-change ではなく恒常的な不変条件)。
set -euo pipefail

repository_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$repository_root"

api_file="applications/backend/src/NativeTrace/Worker/Api.hs"
app_file="applications/backend/src/NativeTrace/Worker/Application.hs"

if [ ! -f "$api_file" ] || [ ! -f "$app_file" ]; then
  echo "verify-servant-route-handler-parity: Api.hs/Application.hs not found (skip)"; exit 0
fi

# --- route 数: `type WorkerApi =` ブロック内の HTTP method combinator を数える ---
# ブロック: `type WorkerApi` を含む行から、その後で先頭が非空白の行 (= 次のトップレベル宣言) が
# 来る直前まで。method combinator は単語境界で数える (Get/Post/Put/Delete/Patch)。
# \< \> (GNU 拡張の単語境界) は BSD awk で効かないため、境界を明示した移植可能な match ループで数える。
route_count="$(awk '
  function countmethods(line,   c,t) {
    c=0; t=line
    while (match(t, /(^|[^A-Za-z])(Get|Post|Put|Delete|Patch)([^A-Za-z]|$)/)) {
      c++
      t = substr(t, RSTART + RLENGTH - 1)   # 末尾境界文字を残して継続
    }
    return c
  }
  /^type[[:space:]]+WorkerApi/ { inblock=1; n+=countmethods($0); next }
  inblock==1 {
    if ($0 ~ /^[^[:space:]]/) { inblock=0; next }   # 次のトップレベル宣言で終了
    n+=countmethods($0)
  }
  END { print n+0 }
' "$api_file")"

# --- handler 数: `server = ...` ブロック内のトップレベル `:<|>` を数えて +1 ---
# `server ::` (型シグネチャ) は対象外。`server =` の本体 (継続行含む) を抽出して `:<|>` を数える。
handler_combinators="$(awk '
  /^server[[:space:]]*::/ { next }                 # 型シグネチャは無視
  /^server[[:space:]]*=/ { inblock=1; n+=gsub(/:<\|>/,"&"); next }
  inblock==1 {
    if ($0 ~ /^[^[:space:]]/) { inblock=0; next }   # 次のトップレベル宣言で終了
    n+=gsub(/:<\|>/,"&")
  }
  END { print n+0 }
' "$app_file")"
handler_count=$((handler_combinators + 1))

echo "verify-servant-route-handler-parity: routes(Api.hs)=$route_count handlers(Application.hs)=$handler_count"

if [ "$route_count" -ne "$handler_count" ]; then
  echo "POLICY VIOLATION: Servant route 数と handler 数が一致しません。" >&2
  echo "  $api_file: WorkerApi の route 数 = $route_count" >&2
  echo "  $app_file: server の handler 数 = $handler_count" >&2
  if [ "$route_count" -gt "$handler_count" ]; then
    echo "  → Api.hs に route を追加したが Application.hs の 'server = ... :<|> ...' に handler を結線していません。" >&2
    echo "    Application.hs の server 行に handler を 1 つ追加し、対応する Handler 関数を定義してください。" >&2
  else
    echo "  → handler 数が route 数を超えています。Api.hs の WorkerApi に route を追加するか、余分な handler を外してください。" >&2
  fi
  echo "  補足: Servant は最終的に型エラーで弾きますが、このゲートは build を待たず未配線を即座に検出します。" >&2
  exit 1
fi

echo "verify-servant-route-handler-parity: OK"
