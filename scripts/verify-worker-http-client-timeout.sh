#!/usr/bin/env bash
# agent-policy: Worker の外部サービス HTTP クライアント (*Client.hs) が responseTimeout を
#   明示設定しているかを検査する。
#
# 背景 (incident 2026-06-14-worker-http-client-default-30s-timeout):
#   `newManager tlsManagerSettings` + `httpLbs` を responseTimeout 未設定で使うと http-client の
#   default 30s に依存する。発音解析 /v1/analyze (wav2vec2+parselmouth+Kokoro で正当に ~20-40s) や
#   golden RVC (CPU 推論 + 初回 HF DL で 30s 超) のような重い ML/推論サービスでは 30s が過小で、
#   ResponseTimeout が「解析失敗」に化ける false-negative になる。AnalyzerClient は修正済だが
#   GoldenSpeakerClient が同型未修正で live false-negative を残していた。
#   これは「Request に responseTimeout を明示する」ことでしか防げないため、worker の各 *Client.hs に
#   responseTimeout が存在することを静的に必須化する。
#
# 判定: applications/backend/src/NativeTrace/Worker/*Client.hs のうち
#   `newManager tlsManagerSettings` を含むファイルは `responseTimeout` も含むこと。
#   含まなければ該当ファイル名を stderr に出し exit 1。
#   1 つでも欠けていれば exit 1。全 clean なら "verify-worker-http-client-timeout: OK" を出し exit 0。
# diff 連動はしない (tree 全体を常に検査する恒常的な不変条件)。
# macOS の BSD 系ツール (find / grep -qF) で動く。GNU 専用拡張は使わない。
set -euo pipefail

repository_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$repository_root"

worker_dir="applications/backend/src/NativeTrace/Worker"

if [ ! -d "$worker_dir" ]; then
  echo "verify-worker-http-client-timeout: $worker_dir not found (skip)"; exit 0
fi

# *Client.hs のみを対象にする (BSD/GNU 両対応の find -name glob)。
client_files="$(find "$worker_dir" -name '*Client.hs' -type f 2>/dev/null || true)"
if [ -z "$client_files" ]; then
  echo "verify-worker-http-client-timeout: no *Client.hs under $worker_dir (skip)"; exit 0
fi

missing=""
while IFS= read -r client; do
  [ -z "$client" ] && continue
  # 外部サービスへ HTTP する client (manager を立てる) だけを対象にする。
  if grep -qF -- "newManager tlsManagerSettings" "$client"; then
    if ! grep -qF -- "responseTimeout" "$client"; then
      missing="${missing}  $client (newManager tlsManagerSettings を使うが responseTimeout を明示していない)
"
    fi
  fi
done <<EOF
$client_files
EOF

if [ -n "$missing" ]; then
  echo "POLICY VIOLATION: Worker HTTP client が responseTimeout を明示していません。" >&2
  printf '%s' "$missing" >&2
  echo "該当 *Client.hs の httpRequest record に responseTimeout を追加してください:" >&2
  echo "  responseTimeout = responseTimeoutMicro (timeoutSeconds * 1000000)" >&2
  echo "  (timeoutSeconds は env から読む。例: resolveAnalyzerTimeoutSeconds / resolveGoldenSpeakerTimeoutSeconds)" >&2
  echo "理由: responseTimeout 未設定は http-client の default 30s に依存し、重い ML/推論サービス" >&2
  echo "      (analyze ~40s / golden RVC 30s 超) で ResponseTimeout が『解析失敗』に化ける" >&2
  echo "      (incident 2026-06-14-worker-http-client-default-30s-timeout)。" >&2
  exit 1
fi
echo "verify-worker-http-client-timeout: OK"
