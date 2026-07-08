# Incident log: v2.0 発音フィードバック (proven-done)

## 検出された「緑なのに割れる」事故 (fresh-context verifier が捕捉)
1. **migration 未生成 (M-108, P1)**: schema.ts に finding_dismissals を追加したが pnpm db:generate を再実行せず、
   migration が 0000 のみ。typecheck/unit 全緑だったが実機 `no such table`。spec-grader が捕捉。
   → memory: drizzle-migration-regenerate-after-schema
2. **Dockerfile ハードコード pip (M-124/M-114)**: pyproject に parselmouth/kokoro を追加したが Dockerfile の
   ハードコード pip リスト未更新でイメージ未反映。TTS 500 / F0 空。docker runtime smoke が捕捉。
   → memory: python-analyzer-dockerfile-hardcoded-pip
3. **parselmouth BytesIO バグ**: parselmouth.Sound(BytesIO) は不可。soundfile デコード必須。docker smoke が捕捉。
4. **kokoro/misaki 依存競合**: 原版 phonemizer でなく phonemizer-fork + espeakng-loader 必須。

## 実装者の早期終了パターン (Step 3.5 / 手動 finish が捕捉)
- implementer が型/DTO 層まで実装して budget 切れ、ORPHAN-1/2(view-practice-workspace の passthrough +
  workspace route の messageJa)を残して中断するのを繰り返した。orchestrator が手動で配線を仕上げた。

## eval/rule 昇格候補
- verify-wiring に「frontend schema.ts 変更時は drizzle/*.sql 共変更」ルール追加を検討。
- verify-wiring に「python-analyzer/pyproject.toml 変更時は Dockerfile 共変更」ルール追加を検討
  (現状は compose.yaml/wiring_manifest.yml のみ要求)。
