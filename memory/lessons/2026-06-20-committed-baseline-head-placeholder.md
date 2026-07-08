# Lesson: pinned baseline の再 pin を未コミットで行うと sim の git checkout が黙って巻き戻す

<!-- memory/lessons/<date>-<slug>.md。1 lesson 1 file。誤りと判明したら削除、重複は更新。 -->

## One-line summary (CAND-2)
pinned fixture/baseline (corpus manifest の analyzerCommit / gop.band / topNBest、drizzle migration、
golden baseline 等) の再 pin を **未コミット working-tree 編集**だけで行うと、acceptance sim の
`git checkout -- <file>` cleanup が **INDEX 版 (= placeholder の HEAD)** を復元して再 pin を黙って巻き戻す。
working-tree sim は全緑だが committed artifact は placeholder のまま → fresh clone で sentinel が壊れる。
`scripts/verify-committed-baseline.sh` で committed/index 値を fail-closed に検査して塞いだ。

## KEY INSIGHT
`git checkout -- <file>` は **INDEX 版**を復元する (staged があれば staged、無ければ HEAD)。だから
「実際に復元される版」を検査する: tracked なら `git show :<file>` (index)、staged 無しなら `git show HEAD:`。
UNTRACKED なファイルは index entry を持たず、その再 pin は純 working-tree なので checkout で完全に消える。
これが drift-stage3 の「core files が HEAD で UNTRACKED」穴。

## Trigger (3×、§6 eval しきい値到達)
1. **incident 2026-06-20 drift-stage3** (ADR-031 D12): manifest の live 再 pin (analyzerCommit + gop.band
   + topNBest) を未コミット編集で行い、sim の `git checkout -- manifest.json` が HEAD の placeholder
   (`TODO` / `[h,ə,l,oʊ,...]` / `{-16,-5}`) に 2 回巻き戻した。working-tree は exit-code 5 緑 + 決定論
   flicker=0 + unit 45 pass、だが committed/working state は placeholder。fresh clone で skip 経路が不到達。
2. **memory verify-scripts-skip-untracked**: untracked/uncommitted のみの作業が空振り green を通す盲点
   (default モードの working-tree blindspot)。本 class の committed-vs-working drift と同根。
3. **memory drizzle-migration-regenerate-after-schema / v2 migration-未生成**: schema.ts 変更後
   db:generate を忘れると migration が committed されず、typecheck 緑でも実機 no such table。
   「working-tree/typecheck 緑だが committed artifact が欠落」型の同 failure class。

## Verified facts (fire-check)
- HEAD = 52c4b24、manifest は committed live pin (`analyzerCommit: docker:0a69...|pip:d240...`) を持つ。
- **Check A** (committed pin = placeholder 禁止):
  - index に `analyzerCommit` を `TODO replace with` 置換 (`git add`) → **exit 1**、file flagged
    (jq で pinned 値だけ抽出するため `_comment` の文書記述は誤検出しない)。
  - 52c4b24 から `git checkout` で live pin 復元 → **exit 0**。
- **Check B** (re-pin/impl が untracked 禁止):
  - wiring-map が untracked file を re-pin (`note: re-pin baseline`) と宣言 → **exit 1**。
  - `git add` で stage (tracked) → **exit 0**。
- **Stop hook** (`agent-evidence-gate.sh`): active marker (`.agent-evidence/.active`) + 必須証跡あり
  + placeholder index → **exit 2** で完了ブロック。marker 無し → **no-op exit 0**。
- clean working tree (live pin) → **exit 0**。
- 後始末: manifest は committed live pin に復元 (`git status` clean、fire-check の痕跡ゼロ)。

## 昇格先 (3 layer)
- **Layer 1 静的 gate** (PRIMARY, fail-closed): `scripts/verify-committed-baseline.sh`。
  - scope NARROW (FP=rollback target): Check A は in-scope fixture allowlist (corpus manifest.json) のみ。
    Check B は wiring-map が `re-pin|baseline|pin` と宣言した file のみ。
  - pinned 値は jq で抽出 (`entries[].observed.{analyzerCommit,gop.band,topNBest.phonemes}` /
    `aPriori.expected*`) して走査 → ドキュメント `_comment` / `_calibrationNote` に placeholder 語が
    あっても誤検出しない。jq 無し fallback は pinned key 行のみ走査。
  - default モードは working-tree-aware (verify-scripts-skip-untracked 修正と一貫)。
- **Layer 2 Stop hook + CI**: `agent-evidence-gate.sh` (`.agent-evidence/.active` 時に invoke、非ゼロで
  exit 2) + `.github/workflows/pr-gate.yml` の policy job に step 追加。
- **Layer 3 正本 + rubric**: 正本 `~/.claude/docs/agent-policy.md` §3 (patch/restore sim を回す baseline は
  先に stage/commit、git checkout cleanup なら HEAD/index が live、cp-backup restore なら可) +
  `rubric/core/spec.md` 証拠品質 item (pinned fixture/migration/baseline は `git show HEAD:` で充足判定、
  working-tree-only の緑を証拠にしない) + §8 強制レイヤ表に 1 行。

## General rule
patch/restore sim を回す pinned baseline は **先に stage/commit する**。`git checkout -- <file>` cleanup を
使うなら HEAD/index が live 値を持つこと (placeholder を残さない)。working-tree のみ持続させたい再 pin は
**cp-backup restore** (`cp <f> <f>.bak` → 復元) を使えば INDEX に依存せず保持できる。pinned
fixture/migration/baseline を含む Must の充足は working-tree ではなく **`git show HEAD:` (committed) 値**で
判定する。working-tree 緑は fresh clone の保証にならない。

## Promotion status (CAND-2)
- [x] scripts/verify-committed-baseline.sh 新規 (Check A + Check B、jq pinned-value 抽出、working-tree-aware)
- [x] agent-evidence-gate.sh (Stop hook) に invoke 追加 (active marker 時のみ、非ゼロで exit 2)
- [x] .github/workflows/pr-gate.yml policy job に step 追加
- [x] 正本 agent-policy.md §3 + §8 表に追記 (→ kit 再適用で AGENTS.md/CLAUDE.md 伝播は follow-up)
- [x] rubric/core/spec.md 証拠品質 item + 判定原則 prose
- [x] rules/promoted/promoted.yml (id: committed_baseline_head_placeholder, verified_fires: true)
- [x] FIRE 確認: Check A violation exit 1 / restore exit 0、Check B untracked exit 1 / staged exit 0、
      Stop hook active+placeholder exit 2、manifest committed live pin に復元 (git status clean)

## Follow-up
- **agent-policy-kit 再適用**: 正本を直したので、生成物 AGENTS.md/CLAUDE.md への伝播は kit re-apply で行う
  (生成済み文書は直接編集しない)。kit templates 側 (rubric/core/spec.md, verify-*.sh) への generic 版
  反映も follow-up (native-trace の corpus manifest パスは具体 allowlist なので、generic kit template では
  in-scope fixture を空 allowlist + コメントで指示する形にする)。

## Related
- [[verify-scripts-skip-untracked]] — committed diff 空のとき working-tree フォールバックで空振り green を塞ぐ盲点。本 lesson の Check B (untracked 再 pin) と同根。
- [[agent-dev-follow-pipeline-faithfully]] — orchestrator が sim/git 操作を肩代わりせず pipeline に忠実に従う。再 pin を未コミットで放置する事故と同じ「working-tree 緑で満足する」傾向。
