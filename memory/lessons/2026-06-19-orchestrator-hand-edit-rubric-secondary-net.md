# Lesson: orchestrator の un-delegated hand-edit が束縛を orphan 化する class は 2× (3× ではない)

<!-- memory/lessons/<date>-<slug>.md。1 lesson 1 file。誤りと判明したら削除、重複は更新。 -->

## One-line summary
「orchestrator が implementer に dispatch せず本番コードを hand-edit し、その un-delegated edit が束縛を
orphan 化する (dead-wiring)」という behavioral class の発生回数は **2×** であり、prior の 3× 想定は
miscount だった。behavioral 正本 (§3 + memory `agent-dev-follow-pipeline-faithfully`) の short_rule tier +
CAND-b2 の symptom gate を維持したまま、Haskell 以外の construction site 向けに **doc-only の rubric
secondary net** を 1 行だけ追加する。eval は §6 しきい値 3× まで保留。

## Trigger (正しい count = 2×)
- **FULL — 2026-06-19** `incidents/2026-06-19-adr018-scipy-dockerfile-runtime-dead-wiring.md` event 1
  (GOP-site dead-`Nothing`): orchestrator が `Scoring.hs` を hand-edit し `acousticEvidence` の let 束縛を
  追加したが construction site を `= Nothing` のまま残した。build + test 緑。Step 3.5 grep + static-verifier
  の orphan check が捕捉。
- **PARTIAL — 2026-06-12** `incidents/2026-06-12-v2-pronunciation-feedback.md` (ORPHAN-1/2): orchestrator が
  手動で配線を仕上げ束縛が orphan 化。keyboard-grab confirmed、dead-wiring を pre-merge で捕捉。
- **除外 — 2026-06-13**: implementer の partial-record bug であり、別 class (`haskell_werror_missing_fields`)
  で既にカバー済。本 class に **数えない** (これを誤って数えていたのが prior の 3× miscount の原因)。

## なぜ doc-only / eval を作らないか
- behavioral 正本 (2× tier) は **既に done**: `~/.claude/docs/agent-policy.md` §3 +
  memory `agent-dev-follow-pipeline-faithfully`。再昇格しない。
- 静的 SYMPTOM は CAND-b2 (`haskell_unused_local_binding_dead_wiring`、`-Werror=unused-local-binds` /
  `-Werror=unused-matches`) が Haskell で **PRIMARY** ラインとしてカバー済。
- 不足は compiler-flag 検査を持たない言語の construction site (例: `run-assessment-job/index.ts` の TS literal
  placeholder)。ここを Step 3.5 grep の **SECONDARY** net で埋める。これは exit-code を持たない rubric 追記
  なので fire-check は無い (`verified_fires: false`、他の rubric-only エントリと同様)。
- §6 の eval しきい値は本 class で **3×**。現在 2× なので `evals/wiring/` の eval は作らない
  (`spec_curator_worker_route_confusion` の `eval_deferred` convention に合わせ、3 回目の再発まで保留)。

## General rule
class の発生回数を数えるとき、似て非なる class (ここでは implementer の partial-record bug) を混ぜない。
miscount は不要な eval over-build を招く。orchestrator の keyboard-grab は dead-wiring の温床なので、
変更された本番ソース (.hs/.ts) を grep して orphan let/where 束縛が無いことを確認する。Haskell は CAND-b2 が
build error 化で守るが、TS 等は rubric secondary net + Step 3.5 grep で守る。

## Promotion status
- [x] rubric/core/wiring.md に『orchestrator の keyboard-grab は orphan 束縛を grep で確認する』節を追加
- [x] rules/promoted/promoted.yml に id: orchestrator_hand_edit_dead_wiring を append (eval_deferred 付き、
      CAND-b2 / §3 との overlap を明記)
- [x] CAND-b2 (haskell_unused_local_binding_dead_wiring) の residual を「resolved 2026-06-19 (f32e2ec)」に更新
- [ ] eval (evals/wiring/) は §6 しきい値 3× で作成 (現在 2×、保留)

## Related
- memory `agent-dev-follow-pipeline-faithfully` — /agent-dev 中は orchestrator が実装/統合を肩代わりせず
  subagent に委ねる (本 lesson の behavioral 正本)
- rules/promoted/promoted.yml CAND-b2 `haskell_unused_local_binding_dead_wiring` — 同 symptom の Haskell
  PRIMARY static gate
- memory lesson `2026-06-19-haskell-unused-local-binds-werror.md` — CAND-b2 の詳細
