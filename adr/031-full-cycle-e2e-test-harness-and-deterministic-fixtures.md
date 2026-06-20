# フルサイクル自動 E2E テスト基盤と決定論的音声 fixture（runtime-pending 常態化の解消）

ADR-031: 発音クローズドループを実 route→worker→analyzer→DB→UI で自動実行・assert する full-cycle テスト基盤と、合成音声による決定論的 fixture corpus の確立

# Status

Proposed

# Context

## 背景（再発する runtime-pending）

発音是正 ADR バッチ（018/019/020/022 の実装スライス）で、proven-done の **runtime-verifier** が要求する「値が contract に到達する / 描画される様子を、live な worker→analyzer→DB→UI 往復で観測する」Must が**毎回実行できず**、unit/component の代替を添えて `pending-justified (runtime-pending)` として受理されてきた。runtime-verify **以外**の全ゲート（build / typecheck / unit / static / spec-grade）は緑に通る。これは ADR-018 の scipy 欠落 dead-wiring（build+unit+static 全緑、runtime のみが捕捉、incident `incidents/2026-06-19-adr018-scipy-dockerfile-runtime-dead-wiring.md`）がすり抜けかけた経路そのものであり、runtime-verify が実行不能であることは品質リスクである。

実機調査で 15 件の escalation を根本原因別に分類した（頻度順）:

- **原因 #1（4 件、唯一の human-escalation 含む）— 特定の音声的性質を持つ入力 fixture が無い**: ①低 GOP /r/（M-APD-7/18）、⑨日本語訛り /l/-/r/→ɾ ミニマルペア（M-HOW-6）、⑪意図的低品質 multipart（M-CRL-16）、⑫録音 blob 不在。harness は `hello_world.wav` と native-clean な LibriTTS/kokoro コーパスしか持たない。
- **原因 #2（4 件）— live HTTP / live UI を駆動する起動済みスタックが無い**: ⑥`docker --profile aai build` 未実行、⑧aai 未起動（M-AAI-23）、⑫Next dev + ブラウザ A/B 不在（M-CRL-13）、⑮stale worker・rebuild 無し（ADR-024 emit 側）。コードは build 時焼き込み（bind-mount 無し）のため `up -d --build` が必須。
- 原因 #3 以降（structurally unfixable）: ②aligner 非決定性（ADR-001）、③speakerSex 常時 unknown（収集 UI 未実装）、⑤`articulatory` モデル checkpoint 入手不可（PyPI 非公開・git install は sandbox block）、⑩音声学レビュー。

**本 ADR は原因 #1 と #2（15 件中 8 件、唯一の hard human escalation を含む）を閉じる。** 原因 #3 以降は構造的に別問題であり本 ADR では閉じない（D9 で明示 non-goal とする）。

## 現状（既存資産。greenfield ではない）

本 ADR は既存資産の上に積む。

- **Playwright E2E が既存**: `applications/frontend/playwright.config.ts`（projects: `chromium` / `mobile-safari` / `progress-chromium`、`fullyParallel:false`、`webServer` は `pnpm dev` を reuse-existing で起動、120s）。`applications/frontend/e2e/` に 8 spec、`test:e2e` script（`package.json:13`）。
- **実 getUserMedia の前例**: `e2e/engine-selector-rerecord.spec.ts` が chromium fake-media flag（`--use-fake-ui-for-media-stream` + `--use-fake-device-for-media-stream`、`permissions:["microphone"]`、非 chromium は `test.skip`）で multipart POST を `page.route` の `route.request().postData()` 正規表現で assert する。他 spec は route-interception 中心で実音声を流さない（`diagnostic.spec.ts` ヘッダ「実録音 / 実 analyzer は e2e では起動しない … runtime-verifier(API レベル)が別途行う」）。
- **DB seed harness が既存**: `e2e/helpers/seed.ts`（899 行、raw `better-sqlite3` INSERT、FK 順序・CHECK 制約遵守、run-unique ULID namespace、`cleanup*`）。ただし `seedWorkspaceV2` は `assessment_results.assessment_result_json` を手書きし worker を迂回する。`db:seed` script は無く、workspace UI が読む実 material+section を作る production seed は無い。
- **追跡済み音声 fixture**: `applications/python-analyzer/test/fixtures/hello_world.wav`（canonical、referenceText "hello world"）+ `applications/python-analyzer/stimuli-assets/`（484 wav: `libritts/{r-l,iy-ih,ae-ah,v-b}` + `kokoro/{aa-ae,dh-z,s-sh,th-s}`、`attribution-manifest.json` に per-clip word/contrast/speaker_sex/license CC-BY-4.0/word_start_end）。いずれも native-clean で、訛り置換も劣化クリップも無い。
- **自前 TTS/合成スタック（人手録音せず fixture を捏造できる）**: analyzer `POST /v1/tts`（Kokoro-82M、`kokoro_tts.py`、24kHz WAV）/ **espeak-ng**（`[[...]]` 音素注入 + build 時 fixture 前例 `Dockerfile:90` `espeak-ng -v en-us -w hello_world.wav`）/ numpy+scipy+soundfile（劣化音声合成）/ RVC（`golden-speaker`）/ ffmpeg（WAV↔WebM）。ingest は `audio/wav` を直接受ける（`practice-attempts/route.ts:16-21`）。
- **live HTTP 経路**: `POST /api/v1/sections/{s}/practice-attempts`（202、非同期）→ in-process `AnalysisJobRunner`（`instrumentation.ts` が boot、約 2s tick）→ `runAssessmentJob` → OSS-worker ACL → worker `:8787/v1/pronunciation-assessments` → analyzer `:8788` → `assessment_results` 永続化 → `GET .../workspace` が findings を読む。`POST /api/v1/findings/{id}/retry-recordings` は自前の inline 30s poll で worker 由来 `gopDelta`/`retrySeverity` を返す。所見は `assessment_results.assessment_result_json` の内側に在る（`findings` テーブルは無い）。
- **Docker**: `compose.yaml`、`worker`/`analyzer` は default、`golden`/`aai` は profile-gated、コード build 時焼き込み（`up -d --build` 必須）、`analyzer` は `start_period:180s` + healthcheck（`--wait` 使用可）。
- **CI**: `pr-gate.yml` の `integration_smoke` は **declare-only**（L54-64「v1 では smoke は wiring_manifest.yml に宣言のみ。follow-up で実行を有効化する」）。

## 制約

- **agent-policy**: 本番に test-double / test-bypass を入れない。seed module・fixture・fake-media flag・合成 script は test scope（`applications/frontend/test/`・`e2e/`・`*.test.*`・`applications/python-analyzer/test/`）に閉じる。`NODE_ENV==='test'` 分岐を本番経路に置かない。新 harness 層を導入する場合は対応する fitness を同 PR で追加する。
- **docker rebuild 必須**: worker/analyzer はコード焼き込みのため変更後 `up -d --build`（memory: docker-rebuild-required-for-code-changes）。
- **ADR-015（LQAS gate）**: 品質判定は speech-active frame 上の RMS（meanDbfs < −36 等）で行う。whole-clip RMS（ffmpeg `volumedetect`）は静音 window で当てにならない。
- **ADR-008 / drizzle**: schema 変更は `db:generate` で migration 再生成し `db:migrate` で適用する。harness も `db:push` を使わない（memory: drizzle-migration-regenerate-after-schema）。
- **real ML は bit-exact でない**: tier-1 は「値が正しい符号・形で contract に到達した」ことを証明し、数値の正しさは証明しない。analyzer の numeric unit fixture を**補完**であって置換しない。

# Decision

**D1 — fixture corpus の first slice は合成音声のみの決定論コーパスとする。** espeak-ng の `[[音素]]` 注入（意図的に誤った音素を発話させ置換所見を捏造）と numpy 生成で fixture を作る。各 clip は manifest（`applications/python-analyzer/test/fixtures/corpus/manifest.json`、既存 `stimuli-assets/attribution-manifest.json` のシェイプに倣う）で記述し、フィールドを **a-priori 真値**（`expectedReferenceIpa` / `expectedQualityStatus` / `expectedCatalogId` / `expectedPhenomenon` → `==` で assert）と **観測値**（`observed.{gop, severity, findingFires, topNBest}` → 帯域で assert し、計測時の `analyzerCommit` に pin、モデル更新時に再計測）に**分離する**。GOP float の厳密一致は禁止する。espeak の formant は wav2vec2 に out-of-distribution であり「置換 clip が実際に所見を発火させるか」は経験的なので、各 clip は一度実測して観測値を pin する。real / 公開コーパス clip（realism、原因 #1 の ⑨）は同一 manifest の裏で後続増分として足す。

**D2 — 品質ゲートと低品質 200 path を駆動する劣化音声を numpy+soundfile で決定論生成する。** ADR-015 LQAS の 4 トリガ（meanDbfs < −36 / duration 不足 / 音素検出率低 / median GOP 低）と M-CRL-16（低品質 200+diagnostic vs 422）を次の recipe で駆動する: (a) 静音寄りクリーン（−40〜−36 dBFS の窄い window）→ low_quality+非空 diagnostic、(b) 短すぎ → duration ゲート（**`durationMs` ゲートは multipart の `recordedDurationMs` form field が駆動する**。バイト長ではない）、(c) 純ノイズ → 整列失敗 → diagnostic 空 → 422、(d) クリーン良好（TTS "light"）→ normal 200。`referenceText` は多音素語（"light"）にして low_quality でも非空 diagnostic を得る。dBFS は送信前に実測して window 内を assert し、しきい値リテラル（`Scoring.hs` の calibratable 定数）をハードコードしない。

**D3 — tier-1 の full-cycle harness を `pnpm test:fullcycle <case>` として実装する。** Node driver（`applications/frontend/test/fullcycle/driver.ts`）が次を行う: スタック起動（`docker compose up -d --build --wait`）→ throwaway `DB_PATH` を `db:migrate` で構築 → skeleton seed（D4）→ ephemeral `next start` boot → fixture 音声を**実 route**（`POST /api/v1/sections/{s}/practice-attempts` または `POST /api/v1/findings/{id}/retry-recordings`）に POST → `assessment_results`（または retry レスポンス）を有界 poll（上限 ~60s、`ANALYZER_TIMEOUT_SECONDS=120` が ~20-30s を正当化）→ JSON/DB invariant を assert → **verdict line** を 1 行出力 → teardown。case は `applications/frontend/test/fullcycle/cases/<name>.case.ts` に置き、同一 driver を共有する。

**D4 — DB seed skeleton を test scope の共有 module に昇格する。** `applications/frontend/test/fixtures/seed/index.ts` に `seedSkeleton()`（material → section_series → section を実 SQL で作るだけ。下流の recording/analysis/assessment 行は作らない=実 route に作らせる）を置き、既存 `seedWorkspaceV2`/`cleanup*` を再 export する（`e2e/helpers/seed.ts` から lift、後方互換の re-export shim を残す）。`db:push` は使わず committed migration（`db:migrate`）で構築する。実 route が動的に作る未知 ID の行は、seed した section への cascade-delete（`cleanup`）で回収する。

**D5 — runtime-verifier が `wiring_manifest.yml` の `smoke:` 経由で `test:fullcycle` を実行する規約に変更し、`pr-gate.yml integration_smoke` を declare-only から invoke に昇格する。** これが runtime-pending 常態化を閉じる規約変更である。`practice-attempts` と `retry-recordings` の `smoke:` エントリに `pnpm test:fullcycle <case>` を宣言し、proven-done の runtime-verify は宣言された smoke を**実行**する。runtime-verify の判定規約: Must の動詞が「returns / contains / computes / 返す / 算出」なら **tier-1 必須**、「renders / displays / 描画」なら tier-2（D6）。verdict line `FULLCYCLE <case> PASS|FAIL entrypoint=<path> observed=<assertion>` を runtime-verify の `entrypoint_reached` + `observable_behavior_asserted` に対応させる。fixture が用意できる Must を runtime-pending として受理することを以後禁ずる。

**D6 — ブラウザ tier-2 は後続増分とし、注入機構を Must の動詞で分ける。** worker の音響出力が試験対象となる唯一のフルサイクル browser test には chromium fake-capture（`--use-file-for-fake-audio-capture=<wav>` + `permissions:["microphone"]`、macOS local では `--no-sandbox` を文書化、`engine-selector-rerecord.spec.ts` の前例）を使う。playback / 所見スコープ A/B / `decodeAudioData` GET / low_quality dock render は route-interception（`page.route` fulfill、実 decodable WAV を返す）で driven する。`getUserMedia`/`MediaRecorder` の JS stub は不採用とする（実エンコードを迂回し、所見を発火させない junk 音声になる）。tier-2 first spec は `e2e/after-panel.spec.ts`。

**D7 — harness・fixture・fake-media は test scope に閉じ、本番経路を一切迂回しない。** seed module / 合成 script / fake-audio flag / DB seed は `applications/frontend/test/`・`e2e/`・`*.test.*`・`applications/python-analyzer/test/` のみに置く。fake-audio flag は `playwright.config.ts` / spec に置き、アプリコードに置かない。本 ADR が新 harness 層（`test/fullcycle/`）を導入するため、それが本番 `src/` から import されないことを機械強制する fitness（ast-grep ルールまたは `scripts/verify-*.sh`）を同 PR で追加する。

**D8 — first slice は `gop-delta.case` を先頭に最小構成で実装する。** 構成順: (1) `seedSkeleton()` を `test/fixtures/seed/` に昇格、(2) `test/fullcycle/driver.ts`、(3) case 1 は `hello_world.wav` を再利用、(4) **`gop-delta.case.ts` を最優先**（practice-attempts → AnalysisJobRunner → worker → retry-recordings → `/v1/gop-delta` を端から端で駆動し、`assessment_results` の着地・`gopDelta` が有限・`retrySeverity ∈ {critical,major,minor,suggestion,none}` を assert、加えて frontend に `-12.0`/`-8.0` リテラル不在を grep=M-CRL-11 不変条件）、(5) `test:fullcycle` script + `wiring_manifest.yml smoke:` エントリ。`rhoticity` case と `aai` case は同 driver 上に約 40 LOC の additive。明示的に後送: tier-2 Playwright AFTER-panel、`fullcycle.yml` CI workflow、hybrid real/corpus 音声。

**D9 — 構造的に閉じられない 3 点を明示 non-goal として宣言する。** 本 ADR は次を閉じることを約束しない: ②aligner 非決定性（ɹ 区間が audio 外へ膨張し全 NaN、ADR-001 scope）、③speakerSex 常時 unknown（実機で 3 層配線を活かすには性別収集 UI が要る）、⑤`articulatory` モデル checkpoint 入手（S-AAI-5、ADR-019 の Proposed→Accepted 昇格 gate）。これらは fixture でも harness でも解けず、別 ADR / 別作業が要る。

## D10-D12 追補（2026-06-20）— 自己完結な品質自己評価と自己改善ループ

ADR-031 の合成 fixture（D1/D8）は static・人手・unlabeled な凍結スナップショットであり、誰も `.case.ts` を書いていない入力での内部整合も、analyzer の dep bump 時の drift（scipy 級 dead-wiring、`incidents/2026-06-19-adr018-scipy-dockerfile-runtime-dead-wiring.md`）も捉えられない。本追補は、analyzer が**自身の出力を変換入力下で読み、既知の関係を assert する label-free（ラベル不要・人間不要）の自己評価ファミリ**と、その違反を既存 self-improve 機構に流す自己改善ループを足す。

**D10 — label-free 自己評価ファミリを定義し、最高リターンの confidence/uncertainty + calibration 測定を metamorphic floor とともに先頭実装する（2026-06-20 deep-research で改訂）。** 当初は注入置換オラクルを最高リターンとしたが、査読文献の adversarial 検証（deep-research、下記 Evidence）で覆った: 合成音声オラクルは 21–34% の false-alarm（synthetic OOD、ISSTA 2023 arXiv:2305.17445）を持ち、CAPT での利得は大半が supervised architecture 由来で注入合成自体は最小寄与（+9%、Korzekwa 2022 arXiv:2207.00774）、学習フィルタでの安全化も refute された。よって**注入置換オラクルは Loop B（self-training data、human-gated、本スライス非対象）へ降格**する。最高リターンの安全・自己完結な自己評価は次の 2 つ:
- (a) **confidence/uncertainty + calibration 測定（Loop A headline）**: 本 analyzer は nBest posterior を既に出すが、現状 production `confidence` は severity の再ラベルで**音響的情報ゼロ**（`Scoring.hs severityToConfidence:1365`）。CTC posterior は構造的に overconfident（peaky POT/POS、生 posterior は GOP/segmentation に不適、arXiv:2507.16838）。test scope で nBest の entropy / top-1 margin（非学習・label-free・reference-free、ICASSP 2023 arXiv:2212.08703）を実計測し、analyzer がどこで overconfident/uncertain かを surface する。post-hoc selective calibration は ECE を 58% 削減し再学習不要（arXiv:2509.07195）だが production scoring に触れるため calibration の**適用**は Loop B（D12-(4)、human-gated）、本スライスは calibration **誤差（ECE 等）の測定**に限る。
- (b) **metamorphic 整合 floor（regression-guard tier）**: ①gain 不変（LQAS window 内で波形 ×a → per-phoneme GOP / detectedIpa / nBest top-1 が不変、ADR-015 の gain-normalization 検証）②noise 単調（SNR 降下ラダーで median GOP が非増加、aligner 境界揺れのため median/quantile で assert）③flip 方向性（−36 dBFS を跨ぐ gain 低下で status が low_quality に転じる一方、floor 上の control では GOP 不変）。metamorphic は自己矛盾を示すのみで「正しさ」は示さない（regression-guard 限定）。

配置は ADR-031 D3 の `test/fullcycle/driver.ts` を拡張し、verdict line `SELFEVAL <family> <case> PASS|FAIL observed=<assertion>` を `FULLCYCLE` と同形にする。観測値は band + `analyzerCommit` pin、float 厳密一致は禁止。**不採用**: cross-engine differential（CrossASR 型 arXiv:2105.14881）は 2nd engine=OpenAI 外部依存で自己完結に反し、ROI 非 monotone-safe・confidence-routing は label 無しで信頼不可（いずれも deep-research で refute）のため採らない。**根本的限界**: label-free で特定音素置換（/r-l/ 等）を localize する手法は査読上存在せず、per-phoneme 誤り検出は GOP 閾値の fit か supervised/synthetic 学習を不可避に要する。よって本自己評価は confidence/uncertainty + calibration 測定 + 整合 regression-guard であり、label-free な音素誤りオラクルではない。

**D11 — リスクの異なる 2 ループを分離し、Loop A のみ自動化する（設計の背骨）。** Loop A（closed software self-test、安全・自動）: metamorphic/cycle/uncertainty/determinism は label も人間も不要な内部整合 assertion で、違反は反証可能な事実。test scope に閉じ、既存 `incidents→evals→rules/promoted` 機構（`~/.claude/docs/agent-policy.md` の昇格しきい値）に乗る。Loop B（model/threshold self-training、危険・自動化禁止）: 同じ信号で wav2vec2 GOP モデルを再学習し、または production 定数（`Scoring.hs` gopMajorThreshold 等）を auto-tune するのは uncalibrated/biased 信号上の自己教師学習であり、production scoring を黙って動かす（ADR-004 が退けた「誤検出が誤是正を教える」）。**metamorphic 違反は analyzer が自己矛盾することを示すが、どちらが正しいかは決して示さない。** よって Loop B は人間 gate の提案で止める。自己改善システムは**証拠収集と drift 検出を自動化し、calibration 判断を escalate する**。

**D12 — corpus 成長・drift 検出・人間 gate calibration の regime を定義する。**
- (1) corpus 成長[自動]: self-eval が違反/hard case を ADR-031 manifest に追記する（a-priori 真値 `==` / 観測 band + `analyzerCommit` pin、署名で de-dup、FP 過多は cap）。
- (2) drift 検出[自動]: `analyzerCommit` 変化または Dockerfile `pip-list` hash 変化（memory: analyzer-dockerfile-hardcoded-pip）で pinned case を再実行し pin と diff、**benign（tolerance 内）は機械的に auto re-pin**。
- (3) regression[escalate]: sign-flip / enum 変化 / 所見 appear-disappear（scipy 級 P0）は human gate で、revert-dep か accept-as-improvement を人間が決める。harness は sign flip を黙って re-pin しない。
- (4) calibration[propose only]: `harness-maintainer` は accumulated 信号から `Scoring.hs` 定数調整を `rules/promoted/<id>.yml type:human_gate` で**提案するのみ**で `Scoring.hs` を編集しない。calibratable 定数行（`Scoring.hs:213-218/237-238/1659-1664`）への diff は人間承認の commit trailer を要し、agent 著者の trailer を拒否する `scripts/verify-*.sh`（既存 `orchestrator_hand_edit` net 同型）で機械強制する。
- (5) self-improve report: verdict / corpus 成長 / drift 分類 / promotion 着地 / **未適用** calibration 提案 / rollback を出す。

# Contract changes / new artifacts

- **`applications/frontend/test/fixtures/seed/index.ts`（新規）**: `seedSkeleton(database, opts): { materialIdentifier, sectionIdentifier, ... }`（material→section_series→section のみ、real SQL/drizzle、idempotent、run-unique namespace）+ 既存 `seedWorkspaceV2`/`cleanup*` の re-export。
- **`applications/frontend/test/fullcycle/driver.ts`（新規）** + **`cases/{gop-delta,rhoticity,aai}.case.ts`**: driver は stack-up→migrate→seed→ephemeral next→1 case→verdict line→teardown。verdict line 形式 `FULLCYCLE <case> PASS|FAIL entrypoint=<path> observed=<assertion>`。
- **`applications/frontend/test/fixtures/audio/`（新規）**: `hello_world.wav` 再利用 + 劣化 WAV（quiet-clean / near-silence / too-short / pure-noise）+ 任意で /r/-/l/ clip。生成 recipe は committed（`gen_fixtures.py` 相当）で再生成可能にする。
- **`applications/python-analyzer/test/fixtures/corpus/`（新規）**: `manifest.json`（a-priori 真値 vs 観測値の分離スキーマ、`attribution-manifest.json` のシェイプに倣う）+ `gen_fixtures.py`。hybrid 増分時に `fetch_corpus.py` + `corpus.lock`。
- **`applications/frontend/package.json`**: `test:fullcycle`、`fullcycle:up`（`docker compose --profile aai up -d --build --wait`）、`fullcycle:down` を追加。
- **`wiring_manifest.yml`**: `practice-attempts` / `retry-recordings` の `smoke:` に `pnpm test:fullcycle <case>` を宣言。
- **`.github/workflows/pr-gate.yml`**: `integration_smoke` を declare-only から invoke へ（後続増分: `.github/workflows/fullcycle.yml` を label `run-fullcycle` + nightly で GHA layer cache + HF model cache 付きで追加）。
- **fitness（新規）**: `test/fullcycle/` と fixture が本番 `src/` から import されないことを ast-grep / `scripts/verify-*.sh` で強制。
- **`e2e/helpers/seed.ts`**: `test/fixtures/seed/` への re-export shim（後方互換）。

# Alternatives considered

- **fixture corpus = 合成音声のみ（採用）** vs **実 JP 訛り録音必須（不採用）** vs **hybrid を今すぐ（不採用）** — 採用理由: 品質ゲート edge（M-CRL-16）と catalog の reference-IPA/catalogId/phenomenon assert は合成のみで exact-equality 決定論的に閉じ、同意/ライセンス摩擦がゼロで CI flake が無い。不採用理由（実録音必須）: biometric PII と同意がブロッカーで再生成不可・N 小、first slice を止める。不採用理由（hybrid を今）: 同意 + fetch-script + manifest の可動部が最多で、決定論コアの価値を先に取れない。real/corpus は同一 manifest 裏の additive 増分にする（realism が要る ⑨ は後続）。
- **ブラウザ音声注入 = fake-capture flag（tier-2 で採用）+ route-interception（playback で採用）** vs **getUserMedia/MediaRecorder stub（不採用）** — 採用理由: fake-capture のみが「mic 実 + エンコード実 + worker 駆動」を満たし、route-interception は repo 既定慣習で playback/`decodeAudioData` に最適。不採用理由（JS stub）: 実エンコードを迂回するか junk 音声になり、worker の音響出力 Must を駆動できない。
- **劣化音声生成 = numpy+soundfile（採用）** vs **ffmpeg/sox `volumedetect`（静音 window で不採用）** — 採用理由: numpy は (−40,−36) dBFS の窄い window を正確に当て、送信前に実測 dBFS を印字して assert できる。不採用理由: `volumedetect` は whole-clip RMS で speech-active RMS ではなく、静音 window で当てにならない（ADR-015）。too-short/pure-noise/good-clean のような余裕のある域では ffmpe/sox も可とする。
- **harness 配置 = tier-1 local（runtime-verifier が invoke、採用）** vs **frontend-ci に inline（不採用）** vs **CI nightly を今（後続）** — 採用理由: runtime-verifier が宣言済み smoke を実行する規約変更が gate を即閉じ、CI コストを払わない。不採用理由（inline）: cold analyzer build（wav2vec2+parselmouth+Kokoro、`start_period:180s`）が frontend-only PR の予算を壊す。後続（CI nightly）: worker 触る PR の強制は GHA layer + HF model cache 付き label-gated/nightly `fullcycle.yml` で別途入れる。
- **E2E 深度 = tier-1（route→worker→DB JSON、採用）+ tier-2 後続** vs **tier-1+tier-2 を両方必須化（不採用 now）** — 採用理由: data-flow/dead-wiring（最大リスクで ADR が詰まった本因）を JSON/DB 層で先に閉じ、render Must は tier-2 で後追いする。不採用理由（両方今）: relaunch コスト + macOS sandbox の脆さで first slice が重くなり、より大きいリスク（wiring）を後回しにする。
- **runtime-verify を declare-only のまま（不採用）** — 不採用理由: 宣言だけの smoke は runtime-pending 常態化を全く解かない。fixture が用意できるのに runtime-pending を受理し続けると、build/unit 緑のまま dead-wiring が live で死ぬ（scipy incident の再演）。
- **自己評価 headline = confidence/uncertainty + calibration 測定（D10、採用、2026-06-20 deep-research で改訂）** vs **注入置換オラクル（headline では不採用、Loop B へ降格）** — 採用理由: nBest entropy/margin は非学習・label-free・reference-free・完全自己完結で、現状 zero-info の confidence（severity 再ラベル）を実音響不確実性で置換でき、CTC overconfidence の測定（ECE）も再学習不要（arXiv:2509.07195/2212.08703/2507.16838）。不採用理由（注入オラクル）: 合成音声は 21–34% false-alarm（OOD、arXiv:2305.17445）、CAPT 利得は大半が supervised architecture 由来で注入合成は最小寄与（+9%、arXiv:2207.00774）、学習フィルタでの安全化も refute。これは self-training（Loop B、human-gated）であり安全な自己評価 headline には不適。metamorphic（gain 不変/noise 単調/flip）は floor として併設（自己矛盾のみ示す regression-guard）。
- **cross-engine differential（CrossASR 型、不採用）** — 不採用理由: 2nd engine=OpenAI cloud は外部依存・有料で 自己完結 に反する。ROI は非 monotone-safe、confidence-routing は label 無しで信頼不可（deep-research で両者 refute）。nightly opt-in の後続増分としても本スライスでは採らない。
- **自己評価ハーネス = full-cycle driver 拡張（D10、採用）** vs **analyzer 側軽量ハーネス（POST /v1/analyze 直叩き、不採用）** — 採用理由: full-cycle は route→worker→DB→UI の配線まで含めて「植えた誤りが永続化所見に出る」ことを端から端で証明する。不採用理由（analyzer 側）: metamorphic は analyzer 内部関係なので軽く速いが、ADR-031 が閉じようとする worker→DB→UI 配線を駆動せず、注入置換オラクルの full-cycle 価値を取りこぼす（cost 度外視のため重い full-cycle を採る）。
- **自己改善 = Loop A 自動 + Loop B 人間 gate（D11、採用）** vs **Loop B auto-tune（不採用）** — 不採用理由: label-free 信号で production scoring 定数を auto-tune するのは biased 信号上の自己教師学習で「誤検出が誤是正を教える」（ADR-004）。証拠収集・drift 検出は自動、calibration は propose-only に限る。

# Consequences

## Positive

- 原因 #1（fixture 不在）と #2（スタック不在）に起因した 8 件の escalation（唯一の hard human escalation を含む）が、fixture + harness で実行可能になる。fixture が用意できる Must が runtime-pending として受理されなくなる。
- `gop-delta.case` が practice-attempts→runner→worker→retry-recordings→`/v1/gop-delta` を端から端で駆動するため、ADR-022 D13-19・ADR-018 /r/ rhoticity・ADR-019 AAI のような将来スライスが live で assert できる。
- 合成音声 fixture が決定論的かつ committed recipe で再生成可能なため、CI flake が無く、モデル更新時は観測値の pin（`analyzerCommit`）を再計測するだけで済む。
- runtime-verifier が宣言済み smoke を実行することで、`integration_smoke` が declare-only から実効ゲートになり、scipy incident 型の dead-wiring が live で捕捉される。
- seed skeleton + 実 route 駆動により、UI/route が「手書き JSON ではない、worker が本当に書いた」所見を読むことを保証する。

## Negative

- full-cycle harness は docker build（cold analyzer は wav2vec2+parselmouth+Kokoro で `start_period:180s`）と stack 起動を伴い、tier-1 でも 1 case あたりの wall-clock が重い。`AnalysisJobRunner` は singleton lease のため case は 1 スタック内で逐次実行になる。
- 合成音声は espeak の formant が wav2vec2 に OOD で、所見が発火するかは経験的。各 clip の観測値を一度実測して pin する保守作業が要り、モデル更新で再計測が必要。realism は劣り、本物の /ɾ/[ɕ] の音響は持たない（⑨ の realism は後続 hybrid 増分まで残る）。
- tier-1 は契約の形・符号到達を証明するが数値の正しさは証明しない（real ML 非 bit-exact）。analyzer の numeric unit fixture を**補完**であって置換しない。
- runtime-verify を実効化すると、fixture/harness を用意できない構造的 pending（aligner/speakerSex/articulatory model）との線引きを毎回明示する運用負荷が増える（D9 で枠を切るが、新規 Must ごとに分類が要る）。
- 新 harness 層（`test/fullcycle/`）が増え、本番から import されない不変条件を機械強制する fitness の保守が要る。

# Compliance

- **smoke 実行の機械化**: `wiring_manifest.yml` の `smoke:` に `pnpm test:fullcycle <case>` を宣言し、`pr-gate.yml integration_smoke` を declare-only から invoke へ変更したことを確認する。proven-done の runtime-verifier が宣言済み smoke を実行することをレビュー rubric（`rubric/core/wiring.md`）に明記する。
- **runtime-verify 判定規約**: Must の動詞が「returns/contains/computes/返す/算出」→ tier-1 必須、「renders/描画」→ tier-2。fixture が用意可能な Must を runtime-pending として受理しないことを rubric で強制する。`FULLCYCLE <case> PASS|FAIL entrypoint=<path> observed=<assertion>` の verdict line を runtime-verify の証跡とする。
- **test scope 強制（agent-policy）**: seed module / fixture / fake-media flag / 合成 script が test scope のみに在り、本番 `src/` から `test/fullcycle/` への import が無いことを ast-grep / `scripts/verify-*.sh` で機械検査する（新規 fitness、同 PR で追加）。fake-audio flag が `playwright.config.ts` / spec のみに在りアプリコードに無いことを grep で確認する。
- **ゲート前提**: harness は throwaway `DB_PATH` を committed migration（`db:migrate`）で構築し `db:push` を使わない。worker/analyzer は `up -d --build --wait` で fresh image を保証する（stale image での偽 green を禁ずる）。
- **honest caveat の明記**: tier-1 PASS は「値が正しい符号・形で contract に到達した」ことのみを意味し、数値正当性は analyzer の numeric unit fixture が担うことを spec/レビューで確認する。
- **manifest 契約テスト**: fixture manifest が a-priori 真値（`==` assert）と観測値（band + `analyzerCommit` pin）を分離し、GOP float を厳密一致で assert していないことを確認する。

# Notes

- Risks:
  - 合成音声の所見発火は経験的。espeak の置換 clip が wav2vec2 上で期待 severity を出さない場合、観測値 band を広げるか real/corpus clip（hybrid 増分）に切り替える必要がある。観測値は `analyzerCommit` に pin し、モデル更新時に再計測する。
  - cold analyzer build が CI/local で重い。local first（runtime-verifier invoke）で gate を即閉じ、CI nightly は GHA layer + HF model cache（Dockerfile + `pip list` hash 鍵、memory: analyzer-dockerfile-hardcoded-pip 整合）付きの後続増分にする。
  - macOS local の fake-capture は sandbox が file を飲み無音になり得る（`--no-sandbox` を文書化）。tier-2 は後続増分のためこのリスクは first slice には及ばない。
  - `AnalysisJobRunner` の singleton lease により case は逐次。並列化は別スタック起動が要る（first slice は逐次で許容）。
  - real/corpus 音声を足す際のライセンス: 公開リポジトリ前提のため、本物の音声は (a) 同意済みの小 WAV を commit、(b) 非公開同意の音声は gitignore + checksum + fetch-script、(c) CC-BY-NC（L2-ARCTIC）/ 有料 ELRA（ISLE）は除外、を方針とする（first slice は合成のみで本方針は未発動）。
- First-slice relevance: FIRST SLICE = D1（合成決定論 corpus + manifest 分離）+ D2（劣化音声 4 境界）+ D3（tier-1 driver `test:fullcycle`）+ D4（seed skeleton）+ D5（smoke invoke 規約 + integration_smoke 昇格）+ D7（test-scope fitness）+ D8（`gop-delta.case` 先頭、`hello_world.wav` 再利用、verdict line）。non-goal: D6 tier-2 Playwright AFTER-panel、`fullcycle.yml` CI workflow、hybrid real/corpus 音声、D9 の構造的 pending 3 点。観測可能 assert: `pnpm test:fullcycle gop-delta` が実 route POST → `assessment_results` 着地 → `gopDelta` 有限 + `retrySeverity ∈ enum` を assert し verdict line PASS を出す。
- Out of scope（structurally pending、D9）: aligner 非決定性（ADR-001）、speakerSex 収集 UI、`articulatory` モデル checkpoint（S-AAI-5/ADR-019）。本 ADR はこれらを閉じない。
- Amends: なし（既存 ADR の決定を再開しない）。本 ADR は ADR-018/019/020/022 の runtime-pending 句を**実行可能にする closure 機構**であり、それらの決定内容は変えない。proven-done runtime-verify の運用規約（rubric/core/wiring.md、agent-policy）に smoke 実行と tier 判定を追加する。
- Depends on: ADR-008（DB モデル / progress_snapshots、harness は throwaway DB に書き snapshot を汚さない）、ADR-014（low_quality 振る舞い）、ADR-015（LQAS gate over speech-active RMS、D2 の劣化生成の根拠）、ADR-018/019/020/022（runtime-pending を閉じる対象）、ADR-012（golden の `--profile`-gated optional-service 形を harness が流用、RVC は任意の fixture 生成レバー）。
- D10-D12 self-eval 追補（2026-06-20、deep-research で headline 改訂）: label-free な品質自己評価ファミリと Loop A/Loop B 分離・drift 検出・人間 gate calibration を本 ADR に追記した。**self-eval first slice**（proven-done で実装）= ADR-031 D3 driver 基盤（driver.ts / seedSkeleton / `test:fullcycle`）+ **confidence/uncertainty 測定**（nBest entropy/top-1 margin を test scope で計測し、zero-info の production confidence と CTC overconfidence を surface）+ **calibration 誤差測定**（ECE 等、測定のみ）+ **metamorphic floor**（gain 不変/noise 単調/flip、regression-guard）。non-goal（後続 / 別ループ）: 注入置換オラクル（Loop B、self-training、21–34% false-alarm のため human-gated）・cross-engine（自己完結に反する=不採用）・determinism probe・drift 自動化 Stage3・calibration の**適用** Stage4（human-gate）・production confidence-field 置換（Loop B、human-gate）・AAI 再構成（model 不在）・RVC 不変（artifact 混入）・VOT（未 emit）。
  - Honest caveat（deep-research 検証）: label-free 信号は優れた regression sentinel だが terrible label（自己矛盾は示すが正解は示さない）。**label-free で特定音素置換（/r-l/ 等）を localize する手法は査読上存在せず**、per-phoneme 誤り検出は GOP 閾値の fit か supervised/synthetic 学習を不可避に要する。nBest entropy は非学習だが calibrated ではない（CTC overconfidence を継ぐ、arXiv:2509.07195）→ calibration 測定と併用。auto step が整合から正しさを推論してはならない。`Scoring.hs` 定数・confidence field は本 self-eval から自動変更しない（D11/D12、verify-*.sh 強制）。
- Author: lihs
- Last updated: 2026-06-20
- Related: ADR-001（GOP/aligner、aligner 非決定性は本 ADR 非対象）、ADR-008（DB）、ADR-014/015（low_quality/LQAS）、ADR-018/019/020/022（runtime-pending を閉じる対象スライス）、ADR-024（emit-side stale worker escalation）、ADR-030（プロトタイプ調整ツールの非プロダクト宣言＝本 ADR の test-scope 原則と整合）。
