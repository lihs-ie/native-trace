# Spec: oss-worker-analyze-timeout

<!-- 設計の正 / 背景:
       adr/014-analysis-pipeline-robustness-low-quality-and-webm.md
         (D3: prosody F0 が WebM を ffmpeg で二重 transcode → analyze レイテンシ上昇を明記。
          Notes follow-up: 「pre-warm the analyzer model … does not risk a cold-start timeout」)
     調査 (2026-06-14 セッション / ログ実測):
       症状: worker ログに大量の
         `HttpExceptionRequest Request { host="analyzer", port=8788, path="/v1/analyze" } ResponseTimeout`。
         analyzer は同じ window で `POST /v1/analyze 200 OK` を返せている (worker timeout 10:08:23 の
         直後 10:08:24 に analyzer 200)。= analyzer は完走しているが worker が先に諦めている。
       実測 (live analyzer, 771KB webm, 短い referenceText):
         /v1/analyze = 20.3s (cold) / 21.9s (warm, 2回目も縮まない)。
         /v1/tts (純粋 Kokoro 合成) = 3.3s → Kokoro 再ロードは主因でない。
         analyze 20s の主因は wav2vec2 強制アライメント (GOP) + parselmouth + Kokoro reference-F0。
       タイムアウト連鎖 (両層とも 30s で過小):
         (1) frontend→worker: ossWorkerTimeoutMilliseconds default 30000ms
             (applications/frontend/src/infrastructure/config/index.ts:24, env OSS_WORKER_TIMEOUT_MS)
             AbortController が 30s で fetch を abort
             (acl/.../oss-worker/create-oss-worker-pronunciation-assessment-adaptor.ts:46)。
         (2) worker→analyzer: AnalyzerClient.hs:401 `newManager tlsManagerSettings` が
             responseTimeout 未設定 → http-client default 30s。ログの responseTimeout=ResponseTimeoutDefault。
       結論: analyze が正当に ~20s かかり実録音 (長い take / 長文 referenceText / WebM 二重 transcode /
         cold start) で 30s を超えるのに、両タイムアウト層が 30s 固定で完走直前に発火する。
     配線点 (agent-policy):
       worker: applications/backend/src/NativeTrace/Worker/AnalyzerClient.hs
         (analyzeAudio / analyzeShadowingLag の manager に responseTimeout 設定)。
         ANALYZER_URL と同様 env から読む (resolveAnalyzerUrl 近傍)。compose.yaml worker env。
       frontend: applications/frontend/src/infrastructure/config/index.ts
         (ossWorkerTimeoutMilliseconds default)。registry.ts が adaptor に注入済 (既配線)。
       compose: compose.yaml worker / frontend(コメント) env。
     強制レイヤ: scripts/verify-no-stub-placeholder.sh / verify-wiring.sh + fitness hook + CI。 -->

## Goal

- OSS worker 経由の発音解析が `ResponseTimeout` で失敗する事象を解消する。
  根本原因は frontend→worker (30s) と worker→analyzer (30s) の二段タイムアウトが、
  正当に ~20s かかり実録音で 30s を超える `/v1/analyze` のレイテンシに対して過小なこと。
- 両タイムアウト層の上限を、analyze の現実的最悪レイテンシ (長い録音 + WebM 二重 transcode +
  cold start) を吸収できる値へ引き上げ、env で上書き可能にする。
- analyzer は正当な ML 計算で遅いだけ (バグではない)。タイムアウトを「失敗」に化けさせない。

## Must (満たさなければ done でない)

- [ ] **M-AT-1 (worker→analyzer タイムアウト引き上げ + env 化)**
  `AnalyzerClient.hs` の analyzer 呼び出し (`analyzeAudio` と `analyzeShadowingLag` の両方) が、
  HTTP マネージャ/リクエストに**明示的な responseTimeout** を設定すること。
  値は env (`ANALYZER_TIMEOUT_SECONDS`、未設定時デフォルト **120**) から読み、
  `responseTimeoutMicro (n*1_000_000)` 相当で manager か request に適用すること。
  デフォルトで http-client の 30s を上書きし、`/v1/analyze` が ~20-40s かかっても
  worker が `ResponseTimeout` を投げないこと。

- [ ] **M-AT-2 (frontend→worker タイムアウト引き上げ)**
  `ossWorkerTimeoutMilliseconds` のデフォルトを **30000 から worker 側上限以上 (>=150000ms)** に上げること
  (env `OSS_WORKER_TIMEOUT_MS` 上書きは維持)。
  内側 (worker→analyzer) が先にタイムアウトするよう frontend 側を worker 側より長く取り、
  真に analyzer が hang した場合は worker の 502 (retryable) が surface し、frontend の opaque abort が
  binding constraint にならないこと。

- [ ] **M-AT-3 (real entrypoint 実行 assert: 30s 超 analyze の完走)**
  worker `POST /v1/analyze` (port 8787) を、analyze が **30s を超える**実録音 (長い WebM /
  長文 referenceText) で叩いたとき、worker が `ResponseTimeout` を出さず 200 を返し、
  非空の解析結果 (perPhonemeGop 非空) が返ること。
  修正前は同条件で worker ログに `ResponseTimeout` が出る (回帰の確認軸)。

- [ ] **M-AT-4 (agent-policy 厳守: 偽値なし + 配線実在)**
  本番コードに mock/stub/fake/test-bypass/placeholder stub を入れないこと
  (`verify-no-stub-placeholder.sh` / `verify-wiring.sh` 緑)。
  responseTimeout の env 読み取りが実在の本番呼び出しに配線され (定義のみでない)、
  compose.yaml の worker env に `ANALYZER_TIMEOUT_SECONDS` が宣言されること。
  `.agent-evidence/analyze-timeout/` に commands.txt / wiring-map.json / completion-report.md を残すこと。

## Should (望ましいが必須でない)

- **S-AT-1 (Kokoro KPipeline キャッシュ)**: `kokoro_tts.py` の `synthesize_speech` が
  リクエストごとに `KPipeline(lang_code="a")` を新規生成している。module-level singleton /
  lru_cache でロードを 1 回にし analyze レイテンシを数秒短縮する。analyzer docker rebuild を伴う。
  本 fix のタイムアウト解消とは独立 (主因でない)。
- **S-AT-2 (analyzer model pre-warm)**: ADR-014 Notes follow-up。起動時に wav2vec2 / Kokoro を
  ウォームして初回 analyze の cold-start を消す。
- **S-AT-3 (タイムアウト値の compose 明示)**: frontend (pnpm dev) 側の `OSS_WORKER_TIMEOUT_MS` を
  .env / 起動ドキュメントに明記する。

## 受入条件 (acceptance — Must の確認方法)

- **M-AT-1** →
  `grep -nE "ANALYZER_TIMEOUT_SECONDS|responseTimeout|ResponseTimeoutMicro" applications/backend/src/NativeTrace/Worker/AnalyzerClient.hs`
  で env 読み取りと responseTimeout 適用が analyzeAudio / analyzeShadowingLag 両方に存在。
  `cabal build all` 成功。
- **M-AT-2** →
  `grep -n "ossWorkerTimeoutMilliseconds" applications/frontend/src/infrastructure/config/index.ts`
  で default が 150000 以上。`pnpm typecheck` 緑。
- **M-AT-3** →
  worker を rebuild (`docker compose up -d --build worker`) 後、30s 超の実録音で
  worker `POST /v1/analyze` を叩き HTTP 200 + perPhonemeGop 非空を観測。
  `.agent-evidence/analyze-timeout/commands.txt` に実コマンドと time_total / HTTP status を記録。
  実行中に worker ログへ新規 `ResponseTimeout` が出ないことを確認。
- **M-AT-4** →
  `bash scripts/verify-no-stub-placeholder.sh` / `verify-wiring.sh` が対象差分で緑
  (memory: verify-scripts-skip-untracked — staged/commit 後に確認)。
  `pnpm fitness` 緑。wiring-map.json に
  `(worker POST /v1/analyze) → AnalyzerClient.analyzeAudio(responseTimeout=env) → analyzer /v1/analyze` を記述。

## Non-goals (今回やらない)

- **analyze レイテンシの本質的短縮**: wav2vec2 / parselmouth の計算量削減はしない。
  遅さは正当 (ML 推論)。S-AT-1/2 は最適化であり本 fix の Must ではない。
- **worker の low-quality 閾値変更 / ADR-014 の挙動変更**: ADR-014 で landed した
  low_quality / partial_succeeded / WebM decode は変えない。
- **タイムアウトの動的・適応化**: 録音長に応じた可変タイムアウトはしない (固定 + env 上書き)。
- **新規 worker ルート / analyzer エンドポイント追加**: タイムアウト設定のみ。契約 (DTO/schema) は不変。
- **cloud (OpenAI) engine の扱い変更**: comparison デフォルト / 404 best-effort は ADR-014 のまま。

## Risk

- level: **medium-risk**
- escalate_to_opus: **false**
- 理由:
  - 変更は 2 層のタイムアウト定数 + env 配線のみで契約 (DTO/schema/ルート) は不変。
    本番テストダブル混入の余地が小さい。
  - ただし worker は Haskell rebuild + docker 焼き込み (memory: docker-rebuild-required /
    haskell-per-edit-hook-burns-subagent-budget) を伴い、real entrypoint 検証に rebuild 必須。
  - real entrypoint 検証は 30s 超の analyze を要するため、長い録音 fixture か長文 referenceText で
    意図的にレイテンシを 30s 超へ持っていく必要がある (短い入力では修正前でも通り回帰を再現できない)。

## Open questions

- **OQ-AT-1 (タイムアウト上限値)**: worker 120s / frontend 150s をデフォルトに置く。
  実録音最悪 (15s take + 長文 + cold) でも ~40-60s 想定なので 120s は十分な margin。
  過大だと真の hang で待ち時間が延びるが env で各環境調整可能。この値で確定してよいか
  (runtime-verify の実測で再調整余地あり)。
