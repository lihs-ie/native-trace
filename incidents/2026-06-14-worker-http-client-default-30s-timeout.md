# Incident: worker→service HTTP client relied on the 30s default responseTimeout, masking a slow analyzer as a failure

date: 2026-06-14
task: oss-worker-analyze-timeout (proven-done)
severity: production failure (analysis appeared to fail for real microphone recordings)

## What happened
本番運用で OSS worker 経由の発音解析が「失敗」していた。worker ログは
`HttpExceptionRequest Request { host="analyzer", port=8788, path="/v1/analyze" } ResponseTimeout` を多発。
だが analyzer は同じ時間帯に `POST /v1/analyze 200 OK` を返せており (worker timeout 10:08:23 の直後
10:08:24 に analyzer 完走)、**analyzer は正常で worker が完走直前に諦めていた**。

根本原因: `AnalyzerClient.hs` の `analyzeAudio` / `analyzeShadowingLag` が
`newManager tlsManagerSettings` + `httpLbs` を **responseTimeout 未設定**で使用 → http-client の
default **30s** に依存。発音解析 `/v1/analyze` は wav2vec2 強制アライメント + parselmouth + Kokoro
reference-F0 で **正当に ~20-40s** かかる (実測: 短文 20s / 長文+大 WebM 40s)。ADR-014 D3 の WebM
二重 transcode がさらにレイテンシを押し上げ、実録音で 30s を超えて ResponseTimeout が発火していた。
frontend 側の `ossWorkerTimeoutMilliseconds` も default 30000ms で同じく過小 (二段タイムアウト)。

## How it was caught
本番ログ調査 + live analyzer への直 `POST /v1/analyze` 実測 (20-22s) でレイテンシ vs 30s デフォルトの
不整合を特定。修正後の runtime-verify は real worker entrypoint
(`POST :8787/v1/pronunciation-assessments`) で 40s analyze の HTTP 200 完走 + ResponseTimeout 0 を観測し、
env 差分 (ANALYZER_TIMEOUT_SECONDS=5 で 5s 失敗) で responseTimeout 配線を実証。

## Fix
1. `AnalyzerClient.hs` に `resolveAnalyzerTimeoutSeconds` (env `ANALYZER_TIMEOUT_SECONDS`, default 120) を追加し、
   analyzeAudio / analyzeShadowingLag 両方の httpRequest に `responseTimeout = responseTimeoutMicro (n*1e6)` を配線。
2. frontend `ossWorkerTimeoutMilliseconds` default 30000 → 150000 (worker 120s ≤ frontend 150s)。
3. compose.yaml worker env に `ANALYZER_TIMEOUT_SECONDS: "120"`。

## Live false-negative (同一クラスの未修正箇所)
`GoldenSpeakerClient.hs:68-73` (`convertGoldenSpeaker`) も **同じ構造** で responseTimeout 未設定の
`newManager tlsManagerSettings` + `httpLbs`。golden RVC は CPU 推論 (F0 変換 + retrieval index、初回 HF DL) で
容易に 30s を超えるため、同じ ResponseTimeout 失敗が起きうる。**修正対象**。

## Lessons (→ /self-improve 昇格候補)
- **rule 候補 (static)**: `applications/backend/src/NativeTrace/Worker/*Client.hs` で
  `newManager tlsManagerSettings` を使い外部サービスへ `httpLbs` する箇所は、必ず Request に
  `responseTimeout` を明示設定する (env から読む)。http-client の default 30s は重い ML/推論サービスに対して
  過小で、ResponseTimeout を「解析失敗」に化けさせる。occurrences: AnalyzerClient (修正済) + GoldenSpeakerClient (未修正)。
  静的に grep で判定可能 → `scripts/verify-*.sh` gate へ。
- **eval/rubric 候補**: worker→service クライアント追加時、timeout 上限が下流サービスの実レイテンシ以上で
  env 上書き可能か、タイムアウト ladder (frontend ≥ worker ≥ 下流処理) が単調かを rubric (haskell pack) で確認。
- **証跡の表記注意**: worker の実 inbound entrypoint は `POST /v1/pronunciation-assessments` であり
  `/v1/analyze` は analyzer 側。spec / wiring-map で entrypoint を analyzer パスと取り違えた (done-evaluator が指摘)。
