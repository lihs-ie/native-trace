#!/usr/bin/env bash
# data-flow 未配線の補助検出: 本番パスに残った「未配線を示す placeholder stub」を検出する。
# 低誤検出方針 — 不完全実装の高信号マーカーのみ対象にする (err501 / notImplemented /
# 本番の undefined / 明示 WIRE-ME・STUB 系)。`= []` や `= Nothing` のような汎用 placeholder は
# 正当な用法と区別できないため**ここでは検出しない** (それらの未配線は real entrypoint の
# 挙動 assert = Step 5 integration-verifier で捕える)。テストディレクトリは対象外。
set -euo pipefail

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$root"

# 本番ソースのみ (テスト/フィクスチャ/生成物を除外)
test_dir_re='(^|/)(test|tests|__tests__|spec|specs|fixtures|testdata|mocks?|stubs?|fakes?|generated)(/|$)'

# 高信号マーカー (本番に残れば未配線/未実装の placeholder の疑い)
markers='throwError[[:space:]]+err501|[^A-Za-z_]notImplemented[^A-Za-z_]|error[[:space:]]+"[^"]*(not[[:space:]]+implemented|unimplemented|TODO)|[^A-Za-z_]undefined[[:space:]]*--|STUB:|PLACEHOLDER:|WIRE-?ME|TODO\([[:space:]]*wire|FIXME\([[:space:]]*wire|TODO:[[:space:]]*wire'

hits=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  printf '%s' "$f" | grep -Eq "$test_dir_re" && continue
  m="$(grep -EnH "$markers" "$f" 2>/dev/null || true)"
  [ -n "$m" ] && hits="${hits}${m}"$'\n'
done < <(git ls-files '*.hs' '*.ts' '*.tsx' '*.py' 2>/dev/null; git ls-files --others --exclude-standard '*.hs' '*.ts' '*.tsx' '*.py' 2>/dev/null)

if [ -n "${hits//[$' \t\n']/}" ]; then
  echo "POLICY VIOLATION: 本番パスに未配線/未実装を示す placeholder stub が残っています。" >&2
  printf '%s' "$hits" >&2
  echo "実装で置き換えて呼び出し側に結線するか、正当なら ci/allowlist.yml に owner/expiry 付きで許可してください。" >&2
  exit 1
fi
echo "verify-no-stub-placeholder: OK"
