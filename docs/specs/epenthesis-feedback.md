# Spec: epenthesis-feedback

<!-- 設計の正 / 背景:
       adr/017-epenthesis-feedback-contract-and-scoring.md (Accepted, 2026-06-18)
         D1: epenthesis を ADR-004 の減点 allow-list に昇格
         D2: analyzer が挿入母音 + 位置を供給、frontend は単語にフォールバックしない
         D3: diagnostic 経路の insertion→epenthesis 取り違えを修正
         D4: frontend 契約に insertionPositionMs を通す
       adr/004-worker-scoring-structured-diff-deductible-allowlist.md
         (D1 が allow-list を拡張する親 ADR。substitution/omission/insertion に epenthesis を追記)
       adr/001 (GOP / detected IPA の供給元。本スライスは GOP 変更なし)
     根本原因 (2026-06-18 実機テスト "this"):
       python analyzer syllable.py が音節数不一致で epenthesis を検出するが insertedVowels を空返し
       → Haskell worker が insertedVowelIpa=Nothing を emit
       → frontend 生成器が `insertedVowel ?? detectedDisplay` で 単語(this) にフォールバック
       → 「this」という母音が挿入されています という無意味な文を出力
       付随: diagnostic が insertion を epenthesis に再ラベル / insertionPositionMs が境界で落ちる /
       epenthesis が ADR-004 allow-list 外で severity 回避 / ScoringSpec に severity/scoreImpact assert なし
     配線点 (agent-policy):
       python analyzer: applications/python-analyzer/.../syllable.py
         (insertedVowels phoneme + positionMs を detected IPA ↔ expected 差分から populate)
       Haskell worker: applications/backend/src/NativeTrace/Worker/Scoring.hs (551-587)
         + Types.hs:329-330 (findingInsertedVowel / findingInsertionPositionMs) — wire 済み
         + Scoring.hs epenthesis 行の severity=Major / scoreImpact=-5.0 + allow-list 正規化
       frontend ACL: applications/frontend/src/infrastructure/oss-worker/schema
         + EngineFindingDto + response-mapper (insertionPositionMs を通す)
       frontend メッセージ生成器:
         applications/frontend/src/acl/improvement-message/rule-based/
         create-rule-based-improvement-message-generator.ts:88
         (epenthesis branch — ?? detectedDisplay 廃止、null 時は位置ベース汎用文)
       frontend usecase:
         applications/frontend/src/usecase/complete-diagnostic-session/index.ts:261
         (insertion → insertion に修正、epenthesis に化けさせない)
       テスト:
         applications/backend/test/ScoringSpec.hs:195-212 (severity/scoreImpact/insertedVowel 経路)
         frontend *.test.ts(x) — epenthesis メッセージ生成器の母音あり/なし経路
     強制レイヤ: scripts/verify-no-stub-placeholder.sh / verify-wiring.sh + fitness hook + CI
     rebuild 注意: analyzer / worker はバイナリ焼き込み (memory: docker-rebuild-required-for-code-changes)。
       runtime verify 前に `docker compose up -d --build worker analyzer` が必須。 -->

## Goal

- epenthesis（母音挿入）所見が「<word>という母音が挿入されています」という無意味な文を生成しないようにする。
  analyzer が挿入母音の phoneme と位置を同定し、frontend は挿入母音 + 位置を明示する（母音が同定できないときは位置ベース汎用文）。
- epenthesis を ADR-004 の減点 allow-list に正式追加し、`category=pronunciation` / `severity=Major` /
  `scoreImpact=-5.0` を allow-list 整合の減点対象として正規化する。
- frontend が worker の `insertion` 現象を `epenthesis` に再ラベルしないよう diagnostic 経路を修正する。

## Must (満たさなければ done でない)

- [ ] **M-EF-1 (severity/scoreImpact 正規化 + allow-list 追加)**
  `Scoring.hs` の epenthesis 行が `category=pronunciation` / `severity=Major` / `scoreImpact=-5.0` を emit すること。
  ADR-004 の body-range-pinned deductions allow-list に `epenthesis` が追加され、
  connectedSpeech compliance check の回避でなく allow-list 整合の減点対象として正当に通過すること。
  `ScoringSpec.hs` が epenthesis 所見の `severity == Major` かつ `scoreImpact == -5.0` を assert する
  テストケースを持つこと。

- [ ] **M-EF-2 (analyzer: 挿入母音 + 位置の同定)**
  `syllable.py` が detected IPA と expected 音素列の差分から、挿入された母音の phoneme (`insertedVowel`) と
  位置 (`positionMs`) を同定して `insertedVowels` を populate すること。
  Haskell worker の `Types.hs:329-330`（`findingInsertedVowel` / `findingInsertionPositionMs`）および
  `Scoring.hs:551-587` の wire は変更不要（analyzer 側の充填で末端まで届く）。
  `ScoringSpec.hs` が「insertedVowel が存在する経路」と「insertedVowel が Nothing の経路」を
  それぞれ独立したテストケースで assert すること。

- [ ] **M-EF-3 (frontend メッセージ生成器: 単語フォールバック廃止)**
  `create-rule-based-improvement-message-generator.ts` の epenthesis 分岐が以下を満たすこと。
  (a) `insertedVowel` が非 null のとき、挿入母音の phoneme と位置を含むメッセージを生成する
  （例: 「<word> の語末に母音 /ɯ/ が挿入されています」）。
  (b) `insertedVowel` が null のとき、`?? detectedDisplay` を使わず位置ベース汎用文を生成する
  （例: 「<word> に余分な母音が入っています（カタカナ読み混入の傾向）」）。
  (c) いかなる経路でも `「<word>」という母音` という文字列を生成しないこと。
  frontend ユニットテストが (a)(b)(c) の三条件を独立した test case で assert すること。

- [ ] **M-EF-4 (diagnostic 経路の取り違え修正)**
  `complete-diagnostic-session/index.ts:261` が worker の `insertion` 現象を
  `insertion` にマップすること（`epenthesis` にしないこと）。
  `insertion` 現象と `epenthesis` 現象が別々の key に対応し、お互いを上書きしないこと。

- [ ] **M-EF-5 (frontend 契約: insertionPositionMs 貫通)**
  frontend の oss-worker schema / `EngineFindingDto` / response-mapper が `insertionPositionMs` を
  持ち、worker が emit する値が frontend まで落ちずに届くこと。
  `pnpm typecheck` が緑（型エラーなし）で、response-mapper ユニットテストが
  `insertionPositionMs` の有無をカバーすること。

- [ ] **M-EF-6 (agent-policy 厳守: 偽値なし + 証跡)**
  本番コードに mock/stub/fake/dummy/spy / test-bypass / placeholder stub を入れないこと
  (`scripts/verify-no-stub-placeholder.sh` / `verify-wiring.sh` 緑)。
  real public entrypoint（最低でも worker `POST /v1/analyze` 経由）から到達可能かつ
  M-EF-1〜M-EF-5 の観測可能挙動を実音声で実行 assert できること。
  `.agent-evidence/epenthesis-feedback/` の commands.txt / wiring-map.json / completion-report.md を提出すること。

## Should (望ましいが必須でない)

- **S-EF-1 (scoreImpact の calibration 余地明示)**: `scoreImpact=-5.0` は既存 Major 値踏襲で calibratable。
  実録音での体感に基づき `Minor/-2.0` に変更する余地を `Scoring.hs` のコメントまたは設定値外出しで示す。
- **S-EF-2 (位置語句の充実)**: `positionMs` が非 null のとき、語頭/語中/語末の区別（例: 「語末に」「<word> の後に」）を
  メッセージに加えると actionability が上がる。M-EF-3 の汎用文に吸収してもよい。
- **S-EF-3 (epenthesis 検出アルゴリズムの accuracy)**: 音節数 VAD の精度は本スライスの Non-goal だが、
  false positive rate が高ければ S として改善検討する。

## 受入条件 (acceptance — Must の確認方法)

> analyzer / worker はバイナリ焼き込みのため `docker compose up -d --build worker analyzer` 後に
> runtime verify を行うこと（memory: docker-rebuild-required-for-code-changes）。

- **M-EF-1** →
  `grep -nE "epenthesis|allowList|allow_list|deductible" applications/backend/src/NativeTrace/Worker/Scoring.hs`
  で epenthesis が allow-list 追加されていることを確認。
  `cabal test all` で `ScoringSpec` の epenthesis severity/scoreImpact テストが緑。
  live worker `POST /v1/analyze` に epenthesis 誤りを含む実録音を投じ、返却 JSON の
  epenthesis finding が `severity: "Major"` かつ `scoreImpact: -5.0` であることを観測 assert すること。

- **M-EF-2** →
  `grep -n "insertedVowel\|positionMs\|inserted_vowel" applications/python-analyzer/.../syllable.py`
  で detected IPA ↔ expected 差分から phoneme と positionMs を求める実装が存在すること。
  `cabal test all` で `ScoringSpec` の「insertedVowel あり」「insertedVowel なし (Nothing)」の両経路テストが緑。
  live worker 経由の解析結果 JSON に `findingInsertedVowel` フィールドが存在し、
  epenthesis 誤りがある録音では非 null の phoneme 文字列（例: `"/ɯ/"`）が入っていること。

- **M-EF-3** →
  `pnpm test --run` で epenthesis メッセージ生成器テストが緑（3 条件: 母音あり / 母音なし汎用 / 単語名指し不在）。
  live worker 経由で epenthesis 所見が返った際のメッセージ `messageJa` に
  `「this」という母音` / `「<word>」という母音` 形式の文字列が含まれないこと。
  `insertedVowel` が null のとき `messageJa` が位置ベース汎用文（`<word> に余分な母音` 系）になっていること。

- **M-EF-4** →
  `grep -n "insertion\|epenthesis" applications/frontend/src/usecase/complete-diagnostic-session/index.ts`
  で `insertion: "insertion"` のマッピングが存在し `insertion: "epenthesis"` が存在しないこと。
  `pnpm test --run` で diagnostic usecase テストが緑、かつ worker `insertion` 現象が
  `epenthesis` に再ラベルされないことを unit test が assert していること。

- **M-EF-5** →
  `grep -n "insertionPositionMs" applications/frontend/src/` を schema / EngineFindingDto /
  response-mapper の 3 箇所で確認。
  `pnpm typecheck` 緑（型エラーなし）。
  live worker 解析結果を frontend ACL に通したとき `insertionPositionMs` が undefined にならず
  数値（ミリ秒）または null として届くこと（response-mapper のユニットテストで assert）。

- **M-EF-6** →
  `bash scripts/verify-no-stub-placeholder.sh` / `bash scripts/verify-wiring.sh` が対象差分で緑
  (memory: verify-scripts-skip-untracked — staged / commit 後に確認)。
  `pnpm fitness` (ast-grep + ESLint 層間依存) 緑。
  `.agent-evidence/epenthesis-feedback/commands.txt` に実 `POST /v1/analyze` コマンドと
  観測した epenthesis finding (`severity`, `scoreImpact`, `messageJa`, `insertedVowel`, `insertionPositionMs`) を記録。
  `.agent-evidence/epenthesis-feedback/wiring-map.json` に
  `syllable.py(insertedVowel+positionMs) → Scoring.hs(allow-list/severity/scoreImpact) → EngineFindingDto(insertionPositionMs) → メッセージ生成器(汎用文)` の経路を記述。

## Non-goals (今回やらない)

- **epenthesis 検出アルゴリズムの信頼性改善**: 音節数 VAD による epenthesis 検出精度・false positive
  rate の改善は本スライスの対象外（ADR-017 Notes 明記）。
- **他 phenomenon メッセージの一括棚卸し**: substitution / omission / linking / flap / weakForm /
  lexicalStress 等のメッセージ品質レビューは本スライスに含めない。
- **ADR-001 の GOP 検出変更**: GOP 計算・detected IPA の供給元ロジックは変更しない。
- **scoreImpact の calibration 実施**: `scoreImpact=-5.0` は確定値として実装する。
  calibration 結果による値変更は後続タスク。
- **golden-speaker / shadowing-lag 経路**: 本スライスの変更は pronunciation assessment 経路
  （analyze エンドポイント → epenthesis 所見）のみ。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由（触れる境界領域）:
  - **3 サービス貫通の契約変更**: python-analyzer（syllable.py の `insertedVowels` 充填）→
    Haskell worker（Scoring.hs allow-list + Types.hs wire）→ frontend ACL（schema / EngineFindingDto /
    response-mapper / メッセージ生成器 / diagnostic usecase）と 3 サービスにまたがる。
    各境界で型・フィールド名の不整合が生じると無音落ちか実行時エラーになる。
  - **scoring / deductible 契約の変更 (ADR-004 拡張)**: allow-list 変更は既存の compliance test の
    前提に触れる。epenthesis が allow-list 外だった状態から内に入るため、
    `ScoringSpec` の compliance check テストが壊れていないことを build + test で確認が必要。
  - **ユーザー向けスコアへの影響**: `scoreImpact=-5.0` / `severity=Major` の正規化は
    epenthesis 所見を持つ全ユーザーの採点結果を変える。減点が今まで 0 だったか不明瞭だった場合、
    スコアが下がる方向に変わる（ADR-017 D1 で intentional と確定済みだが regression として観測される）。
  - **docker rebuild 必須**: analyzer / worker はバイナリ焼き込みのため、コード変更後は
    `docker compose up -d --build worker analyzer` が必要（memory: docker-rebuild-required-for-code-changes）。
    rebuild 前の runtime verify は stale イメージで偽 green になる。
  - **Haskell 編集コスト**: `Scoring.hs` / `ScoringSpec.hs` 変更は per-edit hook が `cabal test` を
    実行するため subagent budget を消費しやすい
    （memory: haskell-per-edit-hook-burns-subagent-budget）。

## Open questions

なし。ADR-017 D1–D4 が確定しており、D1 の `scoreImpact=-5.0` は calibratable と明記されているが
実装値として `-5.0` 固定で開始することも D1 に明記されている。未確定点なし。
