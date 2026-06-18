# Lesson: Worker の外部サービス HTTP client は responseTimeout を明示する (default 30s に依存しない)

<!-- memory/lessons/<date>-<slug>.md。1 lesson 1 file。誤りと判明したら削除、重複は更新。 -->

## One-line summary
`Worker/*Client.hs` が `newManager tlsManagerSettings` + `httpLbs` を **responseTimeout 未設定**で使うと
http-client の default **30s** に依存する。発音解析 `/v1/analyze` (wav2vec2+parselmouth+Kokoro で正当に
~20-40s) や golden RVC (CPU 推論 + 初回 HF DL で 30s 超) のような重い ML/推論サービスでは 30s が過小で、
ResponseTimeout が「解析失敗」に化ける false-negative になる。analyzer は正常応答できているのに worker が
完走直前に諦める。Request に `responseTimeout = responseTimeoutMicro (timeoutSeconds * 1000000)` を明示し、
`timeoutSeconds` を env から読む。`scripts/verify-worker-http-client-timeout.sh` で静的に機械検査する。

## Trigger
同一クラス 2 occurrence。AnalyzerClient.hs の `analyzeAudio` / `analyzeShadowingLag` が default 30s 依存で
本番 ResponseTimeout を多発させていた (修正済) のに対し、GoldenSpeakerClient.hs の `convertGoldenSpeaker` が
**同型の未修正**で残っていた (live false-negative)。incident 2026-06-14-worker-http-client-default-30s-timeout。
既存ゲートはこのクラスを見ておらず、build/test は緑のまま通過する (timeout 未設定はコンパイルエラーにならない)。

## Verified facts
- gate 判定: `applications/backend/src/NativeTrace/Worker/*Client.hs` のうち `newManager tlsManagerSettings`
  を含むファイルは `responseTimeout` も含むこと。BSD/GNU 両対応 (`find -name` + `grep -qF`)。
- 修正前の現状 tree: GoldenSpeakerClient 未修正を gate が exit 1 で検出 (live false-negative の実証)。
- 修正: GoldenSpeakerClient に `resolveGoldenSpeakerTimeoutSeconds :: IO Int` (env
  `GOLDEN_SPEAKER_TIMEOUT_SECONDS`, 未設定/不正時 120) を追加し、`convertGoldenSpeaker` の `Just` 分岐冒頭で
  `liftIO` 取得 → httpRequest record に `responseTimeout = responseTimeoutMicro (timeoutSeconds * 1000000)`。
  AnalyzerClient と同型 (AnalyzerClient は `Handler Int` だが GoldenSpeaker は URL 解決が `IO (Maybe Text)`
  ベースのため timeout も `IO Int` に揃えた)。`compose.yaml` worker env に `GOLDEN_SPEAKER_TIMEOUT_SECONDS: "120"`。
- `cabal build all` exit 0。fourmolu 整形差なし。
- clean (golden 修正後): exit 0。synthetic violation (responseTimeout 行を一時削除): exit 1 + 正しいエラー。
  restore → exit 0。
- Timeout ladder 単調性: frontend `OSS_WORKER_TIMEOUT_MS` (default 150000) ≥ worker
  `XXX_TIMEOUT_SECONDS`×1000 (120000) ≥ 下流 p95。内側が外側を上回ると正常応答を失敗に化けさせる。
- entrypoint 取り違え注意: worker の real inbound entrypoint は `POST :8787/v1/pronunciation-assessments`。
  `/v1/analyze` / `/v1/convert` は worker が呼ぶ下流サービスのパスであり worker の入口ではない
  (done-evaluator が wiring-map の entrypoint 取り違えを指摘)。

## General rule
コンパイラが守らない不変条件 (HTTP client の responseTimeout は未設定でも型が通る) で、かつ「default に依存
すると重い経路で正常応答が失敗に化ける」クラスは、build/test 緑をすり抜ける。同型コードを横展開する前提で
**全 *Client.hs を tree 全体で静的に走査**し、外部 HTTP する client (manager を立てる) に responseTimeout が
存在することを per-edit hook + CI で必須化する。1 occurrence を直しても同型の未修正 (live false-negative) を
gate で同時に潰す。タイムアウトは二段以上なら外側 ≥ 内側で単調にする。

## Promotion status
- [x] grep gate 新設 (scripts/verify-worker-http-client-timeout.sh, BSD/GNU 両対応)
- [x] live false-negative 修正 (GoldenSpeakerClient.hs に responseTimeout 配線 + compose.yaml env)
- [x] cabal build all exit 0
- [x] Wired into fitness hook (scripts/agent-policy-hook.sh、worker の *Client.hs 編集時)
- [x] Wired into CI (.github/workflows/pr-gate.yml policy job の Worker HTTP client explicit responseTimeout step)
- [x] Added Haskell rubric item (rubric/packs/haskell.md: responseTimeout 明示 + timeout ladder 単調性)
- [x] Added core wiring rubric 節 (rubric/core/wiring.md: real_entrypoint を下流パスと取り違えない)
- [x] Recorded in rules/promoted/promoted.yml (id: worker_http_client_explicit_timeout)
- [x] Verified: clean exit 0 / synthetic violation exit 1 / restore exit 0
