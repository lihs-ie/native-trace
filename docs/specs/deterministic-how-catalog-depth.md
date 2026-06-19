# Spec: deterministic-how-catalog-depth

<!-- 設計の正 / 背景:
       adr/020-deterministic-how-catalog-depth-articulatory-diagrams.md (Proposed, 2026-06-18)
         D0: canonicalizePhoneme / normalizeIpaSymbol / PHONEME_ALIASES を共有モジュールに昇格
             (move: usecase/complete-diagnostic-session → domain/error-catalog/phoneme-canonicalization.ts)
         D1: ImprovementMessageGeneratorInput に detectedTopCandidate / nBest を追加し
             run-assessment-job の generate / generateFeedbackLayers 両呼び出し点で配線
         D2: ArticulationGuide に substituteVariants を追加し、howJa を canonicalize 済み
             detectedTopCandidate で分岐させる。ACL howJa 組み立てを findStepsForSubstitute で置換
         D3: japanese-l1-catalog.json に l-r-substitution / r-substitution の substituteVariants と
             新規 f-h-substitution エントリを追加
         D4: findStepsForSubstitute ヘルパを domain/error-catalog/index.ts に追加
             canonical 等価比較に閉じ、findCatalogEntry の latent shadowing bug は修正しない
         D5: public/assets/sagittal/ に CC0 SVG と自作線画 SVG を配置し、
             ArticulationCard の placeholder div を <img> 条件描画に置換。TTS 併置を維持
         D6: catalog coverage 単体テスト + substituteVariants 整合テスト追加
     worker 現状（変更なし）:
       ScoringSpec.hs:303 — findingDetectedTopCandidate f == Just "ɾ"（bare IPA、括弧なし）
       api-types.ts:249-250 — EngineFindingDto に detectedTopCandidate / nBest 既存
       run-assessment-job/index.ts:639-641 — findingDraft.detectedTopCandidate / .nBest 既に参照済み
       (D1 の配線欠損は :581-594 と :597-614 の generator 入力オブジェクトにこれらが渡っていないこと)
     重要ルール（unit fixture）:
       worker は detectedTopCandidate を BARE IPA で出す（例: "ɾ"、"[ɾ]" ではない）。
       fixture に "[ɾ]" を使うと canonicalize が成立しても突合ロジックは発火する偽 green になりうる。
       bare "ɾ" で fixture を書き、bracketed fixture は使わない（unit-fixtures-must-mirror-real-worker-shape）。
     D5 アセット供給注記:
       CC0 Wikimedia SVG（theta.svg / eth.svg / f.svg / ae.svg / i.svg / a.svg）は手動取得が必要。
       /r/ / /l/ / /v/ / /ə/ の CC0 アセットは Wikimedia に存在しないため自作線画 SVG が必須。
       SVG を agent が外部から自動取得することは不可能なため、アセットは人手でリポジトリに追加する。
       ArticulationCard の placeholder fallback 設計（sagittalSvgPath 未設定なら placeholder 表示）により
       一部音素のアセットが未配置でも仕様上は valid（Open questions 参照）。
     findCatalogEntry latent shadowing bug 非修正:
       domain/error-catalog/index.ts:157-179 の findCatalogEntry は単一 .find ディスジャンクションで
       配列順 first match を返す（厳密一致の優先順序なし）。本スライスでは修正しない。
       findStepsForSubstitute は findCatalogEntry に依存せず独立した canonical 等価比較を行うため
       このバグの影響を受けない。
     配線点 (agent-policy):
       frontend: domain/error-catalog/phoneme-canonicalization.ts 新規（domain-pure, I/O なし）
       frontend: usecase/port/improvement-message-generator.ts (ImprovementMessageGeneratorInput 拡張)
       frontend: usecase/run-assessment-job/index.ts (:581-594 / :597-614 両呼び出し点)
       frontend: domain/error-catalog/index.ts (ArticulationGuide 型拡張 + findStepsForSubstitute export)
       frontend: domain/error-catalog/data/japanese-l1-catalog.json (データ追加)
       frontend: lib/articulation-data.ts (ArticulationEntry 型拡張 + sagittalSvgPath 設定)
       frontend: components/workspace/ArticulationCard.tsx (:75-84 placeholder div 置換)
       frontend: public/assets/sagittal/ 新規ディレクトリ + SVG アセット群
     強制レイヤ: scripts/verify-no-stub-placeholder.sh / verify-wiring.sh + fitness hook + CI
     アーキテクチャ制約: domain/error-catalog/phoneme-canonicalization.ts は I/O なし（ドメイン純粋性）
     SLA 文献根拠: Flege SLM / Best PAM（日本語話者は /l/ / /r/ を L1 弾き音に同化）
     効果制約: Kocjancic 2025「図解単体の効果証拠なし、音響併置時のみ」→ TTS 併置必須 -->

## Goal

- How 層（3 層フィードバックの第 3 層）の組み立てを、worker が出す bare IPA の `detectedTopCandidate` に
  応じて音素・実際の代替音ごとに分岐させ、調音指示を actionable にする。
- `canonicalizePhoneme` を共有モジュールへ昇格し、catalog 突合と diagnostic 突合が同一の正規化規則を共有する。
- `/f/` finding の catalog 欠落を解消し、調音図解 placeholder を実在 CC0 SVG（または自作線画 SVG）で置換する。

## Must (満たさなければ done でない)

- [ ] **M-HOW-1 (phoneme-canonicalization 共有モジュール — move)**
  `applications/frontend/src/domain/error-catalog/phoneme-canonicalization.ts` を新規作成し、
  `normalizeIpaSymbol` / `PHONEME_ALIASES`（`ɹ→ɾ`, `r→ɾ`）/ `canonicalizePhoneme` を
  `usecase/complete-diagnostic-session/index.ts:188-209` から移動して export すること。
  `complete-diagnostic-session` はこの共有モジュールから import するよう書き換えること（挙動不変の pure move）。
  このファイルは I/O を持たないドメイン純粋モジュールであること（import に副作用なし）。
  move 後に `complete-diagnostic-session` の既存テストがすべて緑であること。

- [ ] **M-HOW-2 (ImprovementMessageGeneratorInput — detectedTopCandidate / nBest 追加)**
  `applications/frontend/src/usecase/port/improvement-message-generator.ts` の
  `ImprovementMessageGeneratorInput` に
  `detectedTopCandidate?: string | null`（worker が出す BARE IPA 記号、例 `"ɾ"`。`"[ɾ]"` ではない）と
  `nBest?: ReadonlyArray<{ phoneme: string; confidence: number }> | null` を追加すること。
  port の `generate` / `generateFeedbackLayers` シグネチャ自体は変更しないこと。

- [ ] **M-HOW-3 (run-assessment-job — 両呼び出し点への配線)**
  `usecase/run-assessment-job/index.ts` の `:581-594`（`generate` 呼び出し）と
  `:597-614`（`generateFeedbackLayers` 呼び出し）の両方の入力オブジェクトに
  `detectedTopCandidate: findingDraft.detectedTopCandidate ?? null` と
  `nBest: findingDraft.nBest ?? null` を渡すこと。
  どちらか片方のみでは要件を満たさない（両点が必須）。

- [ ] **M-HOW-4 (ArticulationGuide — substituteVariants 型追加 + parseEntry 検証)**
  `domain/error-catalog/index.ts` の `ArticulationGuide` 型に
  `substituteVariants?: Readonly<Record<string, ReadonlyArray<string>>>` を追加すること。
  キーは CANONICAL BARE IPA 記号（例 `"ɾ"`。`"[ɾ]"` ではない）。
  `parseEntry`（同ファイル :108-124）を拡張し、`articulation.substituteVariants` が存在するとき
  各キーが string、各値が string 配列であることを検証すること。
  既存 17 エントリが `substituteVariants` なしでも parseEntry を通過すること（後方互換）。

- [ ] **M-HOW-5 (findStepsForSubstitute ヘルパ — canonical 等価比較)**
  `domain/error-catalog/index.ts` に
  `export function findStepsForSubstitute(entry: ErrorCatalogEntry, detectedTopCandidate: string | null): ReadonlyArray<string>`
  を新規 export すること。
  実装規則:
  - `entry.articulation` が null / `substituteVariants` 不在 / `detectedTopCandidate` が null → `entry.articulation?.stepsJa ?? []` を返す。
  - それ以外: `canonicalizePhoneme(detectedTopCandidate)` と `substituteVariants` の各キーを
    `canonicalizePhoneme` で正規化したうえで等価比較する。一致すればバリアント step 配列、なければ `stepsJa`。
  - 生文字列の完全一致・部分一致は使わない。canonical 形式同士の等価比較のみ。
  - `findCatalogEntry` の fuzzy `id.includes` 挙動には依存しない（独立した追加経路に閉じる）。

- [ ] **M-HOW-6 (ACL howJa 組み立て — findStepsForSubstitute に置換)**
  `acl/improvement-message/rule-based/create-rule-based-improvement-message-generator.ts` の
  howJa 組み立て（:171-179 の `stepsJa.slice(0, 3)` 無条件連結）を以下に置換すること:
  1. `fallbackEntry` を解決（catalogId 優先、なければ `findCatalogEntry`）。
  2. `steps = findStepsForSubstitute(fallbackEntry, input.detectedTopCandidate)`。
  3. `howJa = steps.slice(0, 3).join("。") + (steps.length > 3 ? "。…" : "")`（既存組み立て規則と同一）。
  `input.detectedTopCandidate` が null のときは従来と同じ汎用 `stepsJa[0..2]` を返すこと（後方互換）。

- [ ] **M-HOW-7 (japanese-l1-catalog.json — データ追加 3 件)**
  以下 3 点をすべて満たすこと:
  (a) `l-r-substitution` エントリの `articulation.substituteVariants` に
      `"ɾ"` キー（BARE）で「舌先を歯茎にしっかり当て、両脇から息を流す（側面気流）」を
      主軸とする step 配列を追加すること。
  (b) `r-substitution` エントリの `articulation.substituteVariants` に
      `"ɾ"` キー（BARE）1 つ（舌先を一切接触させず後退・舌中央を盛り上げる、弾き接触を解除する）を追加すること。
      `"l"` キーは追加しない（PHONEME_ALIASES で `ɹ/r/ɾ` が `ɾ` に collapse し、
      `l` を detectedTopCandidate から復元不能なため）。
  (c) 新規エントリ `f-h-substitution` を追加すること:
      `kind="segmental"`, `targetPhoneme="/f/"`, `contrast="/f/-/h/"`,
      `confusionSet=["[h]","[ɸ]"]`, `functionalLoad="mid"`, `intelligibilityImpact="mid"`,
      `recommendedTraining=["articulation","perception"]`, `evidenceStrength="mid"`, `evidenceIds=["E-8"]`,
      `l1MechanismJa`（日本語は /h/ が /u/ 前で [ɸ] となり唇歯摩擦 /f/ が体系にない旨）,
      `articulation`（既存 `articulation-data.ts` の `/f/` step を流用、`/v/` 項目の構造をミラー）。

- [ ] **M-HOW-8 (ArticulationEntry — sagittalSvgPath フィールド追加)**
  `lib/articulation-data.ts` の `ArticulationEntry` 型に
  `sagittalSvgPath?: string`（例 `"/assets/sagittal/l.svg"`）を追加すること。
  `ARTICULATION_DATA` の各項目に、SVG アセットが配置済みの音素は解決済みパスを設定すること
  （未配置音素はフィールドを省略し placeholder にフォールバックする — 後方互換）。

- [ ] **M-HOW-9 (public/assets/sagittal/ — SVG アセット配置)**
  `applications/frontend/public/assets/sagittal/` を新設し、以下を配置すること:
  - CC0 Wikimedia SVG（Richard Wright & Dan McCloy / UW Linguistics, CC0）:
    `theta.svg` / `eth.svg` / `f.svg` / `ae.svg` / `i.svg`（/iː/ と /ɪ/ の近似 proxy）/
    `a.svg`（/ɑ/ と /ʌ/ の近似 proxy）。
  - 自作線画 SVG（CC0 / 著作者自身、本リポジトリで作成）:
    `r.svg` / `l.svg` / `v.svg` / `schwa.svg`（`a.svg` を流用しない）。
  各 SVG ファイルの先頭コメントに出典・ライセンス・作者を記載すること。
  CC BY-NC ライセンスのアセット（SeeingSpeech / Dynamic Dialects 等）を含めないこと。
  Wikimedia の `ʁ`（uvular 摩擦音）は `/r/` の代替として使用しないこと。
  自作 SVG の `/r/` は英語 retroflex/bunched approximant の調音を示すこと（調音的レビューが必要）。

- [ ] **M-HOW-10 (ArticulationCard.tsx — placeholder div を <img> 条件描画に置換)**
  `ArticulationCard.tsx:75-84` の `.artic-fig` 内斜めストライプ placeholder div を
  `entry.sagittalSvgPath ? <img src={entry.sagittalSvgPath} alt={`/${entry.phoneme}/ の調音断面図`} /> : <従来 placeholder>`
  の条件描画に置換すること。
  `sagittalSvgPath` を持たないエントリは placeholder にフォールバックすること（後方互換）。
  図解は既存 `ArticulationCard.tsx:118-159` の `.artic-audio` TTS ブロックと**同一カード内**に併置されること
  （Kocjancic 2025「音響併置なしには証拠なし」制約）。

- [ ] **M-HOW-11 (D6 — catalog coverage テスト + substituteVariants 整合テスト)**
  以下 2 種のテストを追加すること:
  (a) catalog coverage テスト:
      `HIGH_PRIORITY_PHONEME_SET` の各音素が `japanese-l1-catalog.json` で**被覆**されていることを
      assert すること。被覆 = `targetPhoneme` 一致 **OR** いずれかのエントリの `contrast` ペアの一方として出現
      **OR** `confusionSet` に出現。目的は /f/ のように catalog から**完全に欠落**している音素を write-time に
      検出することであり（ADR-020 D-2/D6 の intent）、正当に被覆された母音 contrast 相手を誤って fail させない。
      被覆を `targetPhoneme` 厳密一致に限定しない理由（実装時に確認した事実、2026-06-18）:
      `/ʌ/` と `/ɪ/` は独立した `targetPhoneme` エントリを持たず contrast ペアの第2音素として被覆される
      （`/ʌ/` は `ae-a-substitution` の `contrast="/æ/-/ʌ/"`、`/ɪ/` は `iː-ɪ-substitution` の `contrast="/iː/-/ɪ/"`）。
      `targetPhoneme` 厳密一致では正当に被覆されたこの 2 母音が誤って fail する。`/f/` は新規 `f-h-substitution`
      追加後に `targetPhoneme="/f/"` で被覆される。
  (b) substituteVariants 整合テスト:
      各エントリの `substituteVariants` キーを `canonicalizePhoneme` で正規化した集合が、
      当該エントリの `confusionSet` を `canonicalizePhoneme` で正規化した集合の
      部分集合であることを assert すること（孤児バリアント + 括弧揺れ防止）。
  両テストは `pnpm test --run` で緑であること。

- [ ] **M-HOW-12 (agent-policy: 本番に偽値なし + 証跡)**
  本番コードに mock / stub / fake / dummy / spy / test-bypass / placeholder stub を入れないこと
  （`scripts/verify-no-stub-placeholder.sh` / `verify-wiring.sh` 緑）。
  `pnpm fitness`（ast-grep + ESLint 層間依存）が緑であること。
  `.agent-evidence/deterministic-how-catalog-depth/commands.txt` /
  `.agent-evidence/deterministic-how-catalog-depth/wiring-map.json` /
  `.agent-evidence/deterministic-how-catalog-depth/completion-report.md` を提出すること。

## Should (望ましいが必須でない)

- **S-HOW-1 (i.svg / a.svg の近似 proxy 明示)**: `i.svg` が `/iː/` と `/ɪ/` の近似 proxy、
  `a.svg` が `/ɑ/` と `/ʌ/` の近似 proxy であることを UI ラベルまたは `alt` テキストに明示すること。
- **S-HOW-2 (r-substitution の信号限界の明示)**: `r-substitution` の `l1MechanismJa` / Notes に、
  `PHONEME_ALIASES` により `ɹ/r/ɾ` が canonical `ɾ` に collapse するため
  英語接近音 [r] と日本語弾き音 [ɾ] を `detectedTopCandidate` から区別できない旨を記載すること。
- **S-HOW-3 (findCatalogEntry shadowing bug のログ化)**: `findCatalogEntry` の latent shadowing bug
  （単一 `.find` ディスジャンクションで配列順 first match、厳密一致優先なし）を
  別 issue またはコードコメントに記録すること（本スライスでは修正しない）。
- **S-HOW-4 (ADR-021 との D1 先行 landing)**: D0（canonicalize 共有モジュール化）と
  D1（detectedTopCandidate 配線）は ADR-021（LLM ナラティブ）の着手前に landing しておくと
  下流が楽になる（ADR-020 Notes 参照）。

## 受入条件 (acceptance — Must の確認方法)

> unit fixture は必ず BARE IPA 形式（`"ɾ"`）で書くこと。
> `"[ɾ]"` 形式の fixture では canonicalize が成立しても本来の突合バグ（元案の括弧不一致）を
> write-time に検出できず偽 green になる（unit-fixtures-must-mirror-real-worker-shape）。
> runtime verify は live worker（`docker compose up -d worker`）が必要。

- **M-HOW-1** →
  `ls applications/frontend/src/domain/error-catalog/phoneme-canonicalization.ts`
  でファイルが存在すること。
  `grep -n "export.*normalizeIpaSymbol\|export.*PHONEME_ALIASES\|export.*canonicalizePhoneme" applications/frontend/src/domain/error-catalog/phoneme-canonicalization.ts`
  で 3 つの export が確認できること。
  `grep -n "phoneme-canonicalization" applications/frontend/src/usecase/complete-diagnostic-session/index.ts`
  で共有モジュールからの import が確認できること。
  `grep -rn "normalizeIpaSymbol\|PHONEME_ALIASES\|canonicalizePhoneme" applications/frontend/src/usecase/complete-diagnostic-session/index.ts`
  でローカル定義が 0 件であること（移動済み）。
  `pnpm test --run` で complete-diagnostic-session の既存テストが緑であること。

- **M-HOW-2** →
  `grep -n "detectedTopCandidate\|nBest" applications/frontend/src/usecase/port/improvement-message-generator.ts`
  で `ImprovementMessageGeneratorInput` 内に両フィールドが確認できること。
  `pnpm typecheck` 緑。

- **M-HOW-3** →
  `grep -n "detectedTopCandidate\|nBest" applications/frontend/src/usecase/run-assessment-job/index.ts`
  で `:581-594` 付近と `:597-614` 付近の両ブロックに渡しが確認できること（片方のみは不可）。
  `pnpm typecheck` 緑。

- **M-HOW-4** →
  `grep -n "substituteVariants" applications/frontend/src/domain/error-catalog/index.ts`
  で `ArticulationGuide` 型定義と `parseEntry` 内の検証分岐が確認できること。
  既存カタログを parseEntry に通すテストが `substituteVariants` なしで pass すること
  （`pnpm test --run`）。

- **M-HOW-5** →
  `grep -n "export.*findStepsForSubstitute" applications/frontend/src/domain/error-catalog/index.ts`
  で export が確認できること。
  ユニットテスト（BARE fixture `detectedTopCandidate="ɾ"` 使用）が以下を assert して緑であること:
  - `canonicalizePhoneme("ɾ") === "ɾ"` / `canonicalizePhoneme("[ɾ]") === "ɾ"` /
    `canonicalizePhoneme("ɹ") === "ɾ"` / `canonicalizePhoneme("r") === "ɾ"`。
  - `findStepsForSubstitute(entryWithVariant, "ɾ")` がバリアント step 配列を返すこと
    （`stepsJa` と異なること）。
  - `findStepsForSubstitute(entryWithVariant, null)` が `stepsJa` を返すこと。
  - `findStepsForSubstitute(entryWithVariant, "p")` が `stepsJa` を返すこと（一致なし）。
  - **bracketed fixture `"[ɾ]"` は入力に使わない**（bare `"ɾ"` で発火することを検証する）。

- **M-HOW-6** →
  `grep -n "findStepsForSubstitute" applications/frontend/src/acl/improvement-message/rule-based/create-rule-based-improvement-message-generator.ts`
  で howJa 組み立て箇所が確認できること。
  `grep -n "stepsJa.slice(0, 3)" applications/frontend/src/acl/improvement-message/rule-based/create-rule-based-improvement-message-generator.ts`
  が 0 件であること（無条件 slice が除去済み）。
  ユニットテスト（BARE fixture）が以下を assert して緑であること:
  - `/l/` の detectedTopCandidate=`"ɾ"`（BARE）で l-r-substitution の `ɾ` バリアント step を howJa に含むこと。
  - `/r/` の detectedTopCandidate=`"ɾ"`（BARE）で r-substitution の `ɾ` バリアント step（/l/ とは異なる文言）を howJa に含むこと。
  - detectedTopCandidate=null では従来の `stepsJa[0..2]` を返すこと。
  - **bracketed fixture `"[ɾ]"` は入力に使わない**。
  ランタイム検証（live worker）: /l/ 置換を含む実録音を live worker に通し、
  worker が bare `detectedTopCandidate` を出すこと、howJa が汎用 stepsJa とは異なるバリアント step を
  含むこと（汎用 stepsJa に落ちていないこと）を観測すること。

- **M-HOW-7** →
  `cat applications/frontend/src/domain/error-catalog/data/japanese-l1-catalog.json | python3 -c "import json,sys; d=json.load(sys.stdin); e=next(x for x in d if x['id']=='l-r-substitution'); print(e['articulation']['substituteVariants'])"`
  で `"ɾ"` キーが確認できること。
  同様に `r-substitution` の `substituteVariants` に `"ɾ"` キーが存在し `"l"` キーが存在しないこと。
  `cat ... | python3 -c "... next(x for x in d if x['id']=='f-h-substitution') ..."`
  で新規エントリが存在し `targetPhoneme="/f/"` / `contrast="/f/-/h/"` / `confusionSet=["[h]","[ɸ]"]`
  が確認できること。
  `pnpm typecheck` 緑（JSON が型に適合すること）。

- **M-HOW-8** →
  `grep -n "sagittalSvgPath" applications/frontend/src/lib/articulation-data.ts`
  で `ArticulationEntry` 型定義と各エントリへの設定が確認できること。
  `pnpm typecheck` 緑。

- **M-HOW-9** →
  `ls applications/frontend/public/assets/sagittal/`
  で `theta.svg` / `eth.svg` / `f.svg` / `ae.svg` / `i.svg` / `a.svg` /
  `r.svg` / `l.svg` / `v.svg` / `schwa.svg` の存在を確認すること。
  各 SVG のコメントに出典・ライセンスが記載されていること:
  `grep -l "CC0\|CC BY" applications/frontend/public/assets/sagittal/*.svg` で全 SVG がヒットすること。
  `grep -rn "BY-NC\|CC BY-NC" applications/frontend/public/assets/sagittal/`
  が 0 件であること（CC BY-NC アセットが混入していないこと）。
  `grep -rn "uvular\|ʁ" applications/frontend/public/assets/sagittal/r.svg`
  が 0 件であること（/ʁ/ を /r/ 代替として使っていないこと）。

- **M-HOW-10** →
  `grep -n "sagittalSvgPath.*img\|img.*sagittalSvgPath" applications/frontend/src/components/workspace/ArticulationCard.tsx`
  で条件描画の実装が確認できること。
  ユニットテストが以下を assert して緑であること:
  - `sagittalSvgPath` を持つ entry でレンダリングすると `<img>` が描画され、`alt` 属性を持つこと。
  - `sagittalSvgPath` を持たない entry でレンダリングすると placeholder（`<img>` なし）が描画されること。
  - TTS ボタンが同一カード内に存在すること（図解と TTS の併置確認）。
  `pnpm test --run` で ArticulationCard テストが緑。

- **M-HOW-11** →
  `pnpm test --run` で catalog coverage テストが緑であること:
  - `HIGH_PRIORITY_PHONEME_SET` の各音素が catalog で被覆（targetPhoneme 一致 OR contrast ペアの一方
    OR confusionSet 出現）されていることを assert。`/f/`（新規 f-h-substitution で被覆）と
    `/ʌ/`・`/ɪ/`（contrast 相手として被覆）を含む全 11 音素で緑であること。
  `pnpm test --run` で substituteVariants 整合テストが緑であること:
  - 各エントリの substituteVariants キー（canonicalize 済み）が confusionSet（canonicalize 済み）の部分集合であることを assert。

- **M-HOW-12** →
  `bash scripts/verify-no-stub-placeholder.sh` が緑（working-tree または staged 差分対象）。
  `bash scripts/verify-wiring.sh` が緑。
  `pnpm fitness` が緑。
  `.agent-evidence/deterministic-how-catalog-depth/` の 3 ファイルが存在し、
  `commands.txt` に live worker での howJa 分岐観測コマンドと
  観測した `howJa` の実値（バリアント step の文言先頭部分）が記録されていること。
  `wiring-map.json` に
  `worker(bare detectedTopCandidate) → EngineFindingDto → findingDraft →
  run-assessment-job(generate/generateFeedbackLayers 両点) → ImprovementMessageGeneratorInput →
  findStepsForSubstitute(canonicalizePhoneme) → substituteVariants[ɾ] → howJa` の経路が記述されること。

## Non-goals (今回やらない)

- **findCatalogEntry latent shadowing bug の修正**:
  `domain/error-catalog/index.ts:157-179` の `.find` ディスジャンクションにおける
  配列順 first match 挙動（厳密一致優先なし）は本スライスでは修正しない。
  `findStepsForSubstitute` の canonical 等価比較はこのバグの影響を受けないが、
  catalog 拡張時の fuzzy 一致誤爆リスクは残る（別 issue 候補）。
- **bracketed 生文字列一致の導入**:
  `substituteVariants` キーに `"[ɾ]"` 等の bracketed 形式を使い、
  `detectedTopCandidate` と生文字列で比較することは採用しない。
  worker 出力は bare IPA であるため、完全一致は常に不発になる（Option A' 棄却）。
- **wordPosition ベース step override の全項目一般化**:
  `substituteVariants` に加え wordPosition キーの step override を全 catalog エントリに持たせることは
  しない（Option B の全体化は過剰、final-consonant-omission の 1 項目 optional のみ許容）。
- **nBest 信頼度重み付けによる howJa 曖昧化**:
  「弾き音か側面音のどちらかを出しています」等のアンビギュアス文言は生成しない（Option C 棄却）。
  `nBest` は入力に通すが、決定論 How の分岐は canonical `detectedTopCandidate` 単一値のみ使う。
- **AAI / ML 音響→調音インバージョン（SPARC / EMA）**:
  学習者の舌位置をリアルタイム推定して動的図解を生成することは行わない（ADR-019 の別スコープ）。
  本スライスは静的 CC0 SVG + 自作線画の決定論 floor を定義する（Option D 棄却）。
- **SeeingSpeech / Dynamic Dialects の超音波・MRI 動画埋め込み**:
  CC BY-NC ライセンスのため商用バンドル不可（Option E 棄却）。外部リンクとしての参照のみ許容。
- **r-substitution の `"l"` キーバリアント**:
  PHONEME_ALIASES により `ɹ/r/ɾ` が canonical `ɾ` に collapse するため、
  `detectedTopCandidate` からは側面音化（[l]）か弾き音（[ɾ]）かを復元できない。
  `r-substitution` の `"l"` キーは作らない（D3 限界、ADR-020 明記）。
- **LLM ナラティブ（ADR-021）**:
  retry 改善メッセージや個別化ナラティブは ADR-021 のスコープ。本スライスは決定論 rule/catalog バックボーン。
- **backend Haskell / python-analyzer の変更**:
  `detectedTopCandidate`（bare IPA）/ `nBest` は worker から既に `EngineFindingDto` まで届いている
  （`api-types.ts:249-250`、`ScoringSpec.hs:303`）。backend/python-analyzer の wire 契約は変更しない。
- **finding 単位閉ループ（ADR-022）**:
  本スライスでは `ArticulationCard` の「自分で試す」録音ボタン配線は行わない（ADR-022 のスコープ）。
  ただし D5 の図解置換と ADR-022 の録音ボタン配線が同一ファイルを触るため、
  実装順序の調整が推奨される（ADR-020 Notes 参照）。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由（触れる境界領域）:
  - **public export の変更**: `domain/error-catalog/index.ts` へ `findStepsForSubstitute` を新規 export し、
    `phoneme-canonicalization.ts` を domain 層の新規公開モジュールとして追加する。
    オニオンアーキテクチャの層閉じ込め（ast-grep / ESLint 適応度関数）に適合することを確認必須。
  - **behavior-preserving move のリスク**:
    `canonicalizePhoneme` / `PHONEME_ALIASES` / `normalizeIpaSymbol` の共有モジュール移設は
    `complete-diagnostic-session` の import 書き換えを伴う。import 循環・移動漏れが発生すると
    既存テストは緑でも本番挙動が変わりうる。move 後に既存テストで緑を確認することが必須。
  - **背景 job（run-assessment-job）への配線変更**:
    `run-assessment-job` は assessment の中核 background job。
    両呼び出し点（generate / generateFeedbackLayers）の片方のみ配線した場合、
    How 分岐が非決定論的に動作する。2 点配線を grep で確認必須。
  - **誤った調音指示の実害リスク**:
    `substituteVariants` の文言品質は人手依存。バリアント step が誤った調音指示を含むと
    学習者に逆効果の指導を与える（ADR-020 Notes: 「調音指導は知覚訓練と併用したときに価値がある」）。
    音声学的レビューを要する。
  - **detectedTopCandidate 精度の限界**:
    MDD/nBest 由来で日本語 L1 ベンチマーク precision ~60% / recall 40-80%（RISK-6）。
    誤った detectedTopCandidate でバリアント分岐すると誤 How を出す。
    非 null + canonical 一致のときのみ分岐し、不一致・null では汎用 stepsJa に留めることで
    「取りこぼし側に倒す」保守設計を維持する。
  - **自作 SVG の調音的正確性**:
    `/r/`（英語接近音）の正確な CC0 sagittal SVG が Wikimedia に存在しないため自作必須。
    音声学的に不正確な自作 SVG は誤誘導になる。調音専門家またはリポジトリオーナーによる
    レビューが必要（ADR-020 Notes 参照）。
  - **schema（ArticulationGuide 型 / ArticulationEntry 型 / catalog JSON）**:
    ドメイン型と JSON スキーマの変更を伴う。parseEntry の検証追加漏れにより
    不正な substituteVariants がランタイムまで検出されないリスクがある。

## Open questions

- **D5 アセット供給方法**:
  ADR-020 は CC0 Wikimedia SVG を「確認済みで入手可能」と述べるが、
  agent は外部 URL からファイルを取得できない。
  すべての SVG（Wikimedia CC0 分・自作分ともに）は人手でリポジトリに追加する必要がある。
  `sagittalSvgPath` 未設定の音素は placeholder にフォールバックする設計のため、
  一部音素のアセットが未配置でもスペック上は valid（M-HOW-9 と M-HOW-10 の受入条件は
  配置済みファイルに対してのみ確認する形）。
  **判断が必要な点**: M-HOW-9 で「全 10 SVG を配置すること」を Must にするか、
  または「配置可能な分だけ配置し、残りは placeholder 継続」を許容するかは
  リポジトリオーナーが決定すること。現スペックは「全 10 SVG を配置すること」を Must として記述しているが、
  自作 SVG の工数（線画 /r/ /l/ /v/ /ə/ 各 1-2 時間 + 調音的レビュー）が確保できない場合、
  M-HOW-9 を「CC0 Wikimedia 分 6 件を配置すること」に緩和することを検討する。

- **自作 SVG の調音的レビュー担当**:
  `/r/`（英語 retroflex/bunched approximant）と `/ə/` の自作 SVG は音声学的に正確である必要がある。
  レビュー担当者（リポジトリオーナー / 外部音声学専門家）の確保が実装着手前に必要か否か、
  または実装後レビューで足りるかを確認すること。
