# Incident: residuals worker crash — missing record field slipped past green build/test

date: 2026-06-13
task: pronunciation-feedback-v2-residuals (proven-done)
severity: blocking (caught by runtime-verify before merge)

## What happened
`AssessmentFinding` レコード（`Types.hs`）に新フィールド `findingWordPositionLabel :: Maybe Text` を追加し ToJSON で出力するようにしたが、本番の finding builder 3箇所（`buildEpenthesisFindings` / `buildLexicalStressFindings` / `buildWeakFormFindings`）が **レコード構築でこのフィールドを設定しなかった**。GHC `-Wmissing-fields` は **warning 止まり**なので `cabal build` / `cabal test`（38 examples）は緑のまま通過。だが実 analyzer が `expectedStress ≠ predictedStress` を返すと lexicalStress finding が生成され、JSON encode 時に未設定フィールドの bottom thunk が forced され、worker handler が `POST :8787/v1/pronunciation-assessments` で **HTTP 000（接続リセット）crash**。

## How it was caught
proven-done の runtime-verify（real entrypoint 実行 assert）が worker を live で叩いて HTTP 000 を観測。build 緑・unit 緑では出ず、「real entrypoint を実行し観測挙動を assert する」ネットが捕捉した典型例。spec-grader はさらに M-104R-c の観測 assert が e2e seed 直焼きで代替されていた弱点を指摘。

## Fix
1. 3 builder のレコード構築に `findingWordPositionLabel = Nothing` を追加。
2. `native-trace-worker.cabal` の `common warnings` に **`-Werror=missing-fields`** を追加し、このクラスを今後 build error 化（プロンプトでなく適応度関数で防ぐ）。
3. M-104R-c は run-assessment-job を **実 generator** で駆動する統合テストで導出を実行 assert して閉じた。

## Lessons (→ /self-improve 昇格候補)
- **rule 候補**: Haskell でレコードにフィールド追加する PR では `-Werror=missing-fields`（または `-Werror=incomplete-record-updates`）が cabal にあることを CI/fitness で要求する。partial record construction は warning では runtime thunk crash として漏れる。
- **eval 候補**: 「公開レコード型にフィールド追加 → ToJSON で強制評価 → 全 builder が設定済みか」を runtime smoke（real endpoint で全 finding 種を encode）で確認するシナリオ。
- **process**: Haskell の per-edit fitness hook（編集ごと cabal test）が subagent budget を急速に消費し、implementer が結線/テスト完了直前で早期終了する事象が複数回。大きな Haskell タスクは「本番配線」と「テスト追加」を別の小さい implementer に分け、orchestrator は build/test/grep で実機確認する運用が有効だった。
