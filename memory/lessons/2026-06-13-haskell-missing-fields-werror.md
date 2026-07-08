# Lesson: Haskell の partial record construction は warning では runtime crash として漏れる

<!-- memory/lessons/<date>-<slug>.md。1 lesson 1 file。誤りと判明したら削除、重複は更新。 -->

## One-line summary
レコードにフィールドを追加して builder で設定し忘れると GHC `-Wmissing-fields` は warning 止まりで build/test 緑を通過し、ToJSON 等の強制評価で runtime thunk crash になる。`-Werror=missing-fields` で build error 化する。

## Trigger
proven-done pronunciation-feedback-v2-residuals (incident 2026-06-13)。`AssessmentFinding` に
`findingWordPositionLabel :: Maybe Text` を追加したが、本番 builder 3 箇所
(`buildEpenthesisFindings` / `buildLexicalStressFindings` / `buildWeakFormFindings`) が
レコード構築でこのフィールドを設定せず。`cabal build` / `cabal test` (38 examples) は緑。
実 analyzer が lexicalStress finding を生成すると JSON encode 時に未設定フィールドの bottom thunk が
forced され worker handler が `POST :8787/v1/pronunciation-assessments` で HTTP 000 crash。

## Verified facts
- `-Wmissing-fields` は warning 止まりで `cabal build` / `cabal test` を緑通過させる。
- runtime-verifier (real entrypoint 実行 assert) が worker を live で叩いて HTTP 000 を観測。build 緑・unit 緑では出なかった。
- `native-trace-worker.cabal` の `common warnings` に `-Werror=missing-fields` を追加して当該クラスを build error 化した。
- 昇格後の `scripts/verify-haskell-warnings.sh` は cabal から flag を一時除去すると exit 1、復帰で exit 0 を実コマンドで確認した。

## General rule
Haskell でレコードにフィールドを追加する PR では、全 `*.cabal` の warning 設定に
`-Werror=missing-fields` (必要なら `-Werror=incomplete-record-updates` も) があることを
CI / fitness で要求する。partial record construction は warning では runtime thunk crash として漏れる。
「build/test 緑」は record の全 builder が設定済みである証拠にはならない。

## Promotion status
- [x] Added grep gate (scripts/verify-haskell-warnings.sh)
- [x] Wired into CI (.github/workflows/pr-gate.yml policy job)
- [x] Wired into fitness hook (scripts/agent-policy-hook.sh、*.cabal 編集時)
- [x] Added Haskell rubric item (rubric/packs/haskell.md)
- [x] Recorded in rules/promoted/promoted.yml (id: haskell_werror_missing_fields)
- [ ] eval 候補 (runtime smoke で全 finding 種 encode) は未実装
