# Lesson: 計算したが使われない let/where 束縛 (dead wiring) は warning では build 緑を通過する

<!-- memory/lessons/<date>-<slug>.md。1 lesson 1 file。誤りと判明したら削除、重複は更新。 -->

## One-line summary
worker で値を `let`/`where` で計算したのに construction site が literal `Nothing`/default のままだと、束縛が
unused になり機能は dead だが、`-Wunused-local-binds` / `-Wunused-matches` は `-Wall` に含まれるが warning
止まりで `cabal build`/`cabal test` が緑を通過する。`-Werror=missing-fields` の前例に倣い両 flag を build error
化する。

## Trigger
incident 2026-06-19 ADR-018 acoustic-phonetic-diagnosis、event 1 (GOP-site dead-Nothing)。
orchestrator が implementer に委ねず `Scoring.hs` を hand-edit し、`acousticEvidence` の let 束縛を追加したが
GOP 構築サイトを `findingAcousticEvidence = Nothing` のまま残した。結果: 束縛は unused、全 finding が `Nothing`
を emit し機能は dead。だが `cabal build all` + `cabal test all` は緑 (worker は `-Wunused-local-binds` を
`-Werror` にしていなかったため unused 束縛で build が落ちない)。Step 3.5 grep + static-verifier の orphan check
が捕捉。precedent: `-Werror=missing-fields` (partial record construction) も同型の「build 緑で runtime dead」
クラスで 2026-06-13 に 1 回で昇格済。

## Verified facts
- precondition sweep: flag 追加前に `cabal build all` で既存 unused-local-binds/unused-matches warning を
  enumerate → ゼロ (clean tree)。test-suite を含め legit unused は無かったため `common warnings` (全 stanza 共有)
  に追加でき、library stanza への scope 縮小は不要だった。
- `applications/backend/native-trace-worker.cabal` の `common warnings` に `-Werror=unused-local-binds` と
  `-Werror=unused-matches` を `-Werror=missing-fields` の隣に追加。
- fire-check: flag 追加後 `cabal build all` 緑 (exit 0、unused warning ゼロ)。`tokenize` の where に unused
  `unusedProbe = (42 :: Int)` を挿入 → fitness hook の cabal test が
  `GHC-40910 [-Wunused-local-binds, Werror=unused-local-binds] Defined but not used: 'unusedProbe'` で
  build error → 編集ブロック。除去 → 緑。(注: 先頭 `_` 始まりの束縛名は GHC が unused 警告を抑制するため、
  fire-check では非 `_` 名を使う必要がある。)
- `scripts/verify-haskell-warnings.sh` を拡張し worker cabal に両 flag があることを assert。flag 有り exit 0、
  一時削除で exit 1 (欠落 flag を明示)、restore で exit 0 を実コマンドで確認。

## General rule
worker (および同型サービス) では「値を計算したのに construction site が literal default のまま」は build/test
緑を通過して runtime で機能を殺す。`-Werror=unused-local-binds` / `-Werror=unused-matches` で build error 化し、
verify-haskell-warnings.sh で flag 存在を CI/fitness 必須化する。orchestrator が implementer の代わりに
hand-edit して配線を完了報告するのは、この事故の温床 (memory `agent-dev-follow-pipeline-faithfully`)。

## Promotion status
- [x] Added -Werror=unused-local-binds / -Werror=unused-matches to native-trace-worker.cabal (common warnings)
- [x] Extended grep gate (scripts/verify-haskell-warnings.sh が両 flag を assert)
- [x] Wired into CI + fitness hook (既存 *.cabal 編集トリガー + Haskell cabal warnings hardened step)
- [x] Recorded in rules/promoted/promoted.yml (id: haskell_unused_local_binding_dead_wiring)
- residual (本タスク外・ADR-018 uncommitted 由来): Scoring.hs L1136 schwaPhonemes が -Wunused-top-binds
  (top-level、本昇格の対象 class 外)、L83 WordPair が -Wunused-imports、test-suite に -Wmissing-home-modules
  (GoldenSpeakerSpec/ShadowingLagSpec が other-modules 未登録)。いずれも build を壊さず本 flag の対象外。
