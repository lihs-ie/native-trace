# Lesson: verification が wired entrypoint の渡さない便利引数を足すと false-green になる

<!-- memory/lessons/<date>-<slug>.md。1 lesson 1 file。誤りと判明したら削除、重複は更新。 -->

## One-line summary (CAND-1)
verification のコマンドが **wired entrypoint が渡さない便利引数** (例 `--repo-root <abs>` の明示) を足すと、
便利パスだけ緑になり、本番が通る default-arg パスは未実行のまま **false-green** になる。wired path は
crash していたが全コマンド緑だった。静的 arg-diff grep は「しばしば捏造される wiring-map に依存し脆い」と
miner が flag → grep gate は作らず **rubric (実行時 yes/no) + 正本** に昇格する。

## Trigger (5×、corpus spine)
1. **incident 2026-06-20 drift-stage3**: `_REPO_ROOT` が 5-dot off-by-one で `/Users/lihs/workspace`
   (native-trace の親) に解決 → Dockerfile で FileNotFoundError。だが implementer は毎コマンドで
   `compute_fingerprint.py --repo-root /Users/lihs/workspace/native-trace` を明示 (commands.txt:11,34)、
   wired entrypoint `pnpm test:drift` (--repo-root を渡さない) の default-arg 導出は一度も走らせず
   「all green」報告。off-by-one は build/unit/lint に不可視、実 default パス実行だけが捕捉。
2. scipy dead-wiring / 3. markdown-fence / 4. v2 worker-crash / 5. v2 pip-parselmouth: いずれも
   「実ツールが出さない理想 payload fixture / 便利引数 / mock で代替した緑」が entrypoint 未到達を隠した。

## なぜ grep gate を作らないか (miner の判断)
- 静的 arg-diff grep (commands.txt のコマンド vs wiring-map の entrypoint 宣言の引数差分) は **fragile**:
  - wiring-map は **しばしば捏造される** (implementer が書く宣言で、実コマンドと乖離しうる)。grep がこの
    宣言に依存すると、宣言を都合よく合わせた時点で gate が抜ける。
  - 引数フォーマットの揺れ (絶対パス/相対、env 経由、quote) で FP/FN が大きい。
- CAND-2 (committed-baseline) は git の committed 値という **確実な ground truth** があり静的判定できるが、
  CAND-1 は「実 entrypoint が実際に通ったか」という実行時事実なので、**実行時 rubric** の方が信頼できる。
- よって grep gate は意図的に非採用。runtime-verifier が宣言 entrypoint を逐語実行して観測する rubric +
  正本 short_rule に昇格する。

## 昇格先 (rubric + 正本)
- **rubric**: `rubric/core/wiring.md` に yes/no item『entrypoint 逐語実行』+ prose 節『便利引数で
  entrypoint 到達を偽装しない』。runtime-verifier が commands.txt の各行 vs 宣言 entrypoint の引数を
  突き合わせ、追加引数/mock 依存/理想 fixture があれば「entrypoint 未到達・continue」。
- **正本**: `~/.claude/docs/agent-policy.md` §3 に 1 行 (観測 assert は宣言 entrypoint を逐語実行する。
  便利引数・mock 依存・理想 fixture で代替した緑は entrypoint 到達の証拠にしない) + §8 強制レイヤ表に 1 行
  (静的 grep は脆いため非採用と明記)。

## General rule
runtime evidence の各コマンドは `wiring_manifest.yml` の real_entrypoint / `package.json` 宣言 script を
**逐語実行**する。`pnpm test:drift` が `--repo-root` を渡さないなら verification も渡してはいけない。
convenience 引数・mock 依存・実ツールが出さない理想 payload fixture で代替した緑は entrypoint 到達の証拠に
しない。default-arg 導出 (= 本番が通るパス) を一度は実 entrypoint から走らせて観測 assert する。

## Promotion status (CAND-1)
- [x] rubric/core/wiring.md に『entrypoint 逐語実行』yes/no item + 『便利引数で entrypoint 到達を偽装
      しない』prose 節 (incident 5× を列挙)
- [x] 正本 agent-policy.md §3 short_rule + §8 強制レイヤ表に 1 行 (grep gate 非採用と明記)
- [x] rules/promoted/promoted.yml (id: entrypoint_verbatim_execution, verified_fires: false — doc/rubric-only)
- [x] grep gate は意図的に非採用 (miner が fragile と flag、CAND-2 と違い静的判定が確実でない)

## Follow-up
- **agent-policy-kit 再適用**: 正本 §3/§8 を直したので、生成物 AGENTS.md/CLAUDE.md への伝播は kit re-apply。
  kit templates rubric/core/wiring.md にも generic 版 (native-trace の `pnpm test:drift` 具体例は残しつつ、
  generic な entrypoint-verbatim 原則として) を反映する follow-up。
- **eval 保留→将来**: §6 では failure class 3× で eval 作成 (本 class は 5×)。ただし「実 entrypoint が便利
  引数なしで通る」ことの eval は runtime-shaped で、fixture 化が難しい (実 docker/aligner 依存)。
  現状は rubric で runtime-verifier が逐語実行を判定する形に留め、安定した fixture 化方法が見えたら
  evals/wiring/ に昇格する。

## Related
- [[agent-dev-follow-pipeline-faithfully]] — orchestrator が implementer の「all green」報告を鵜呑みにせず
  default パスを自分で再実行して crash を捕捉した (drift-stage3 で実際にこれが効いた)。本 lesson はその
  「便利引数 false-green」を gate-time/rubric-time の検査に昇格したもの。
- rubric/core/wiring.md の『implementer 終了メッセージを配線証拠にしない』節と同系統 (緑/予告を
  entrypoint 到達の証拠にしない)。
