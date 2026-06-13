# Lesson: 宣言を変えたら派生成果物の共変更を co-change ゲートで強制する

<!-- memory/lessons/<date>-<slug>.md。1 lesson 1 file。誤りと判明したら削除、重複は更新。 -->

## One-line summary
「宣言ファイルを変更したが、それを実体化する派生成果物 (migration / コンテナ依存) を再生成し忘れる」未配線は、typecheck / build 緑では捕捉できない。宣言↔実体を `wiring_manifest.yml` の co-change ルールで強制する。

## Trigger
2 件の同型 incident (2026-06-12):
- drizzle `schema.ts` を変更したが `pnpm db:generate` を忘れ、migration SQL 未再生成 → 実機で `no such table`。typecheck は緑。
- python-analyzer `pyproject.toml` に依存を追加したが Dockerfile (ハードコード pip list) 未更新 → コンテナに反映されず TTS 500 / f0 empty。
memory: drizzle-migration-regenerate-after-schema, python-analyzer-dockerfile-hardcoded-pip。

## Verified facts
- 宣言 (schema.ts / pyproject.toml) は静的検査・型・unit を緑通過する。欠けるのは「派生成果物の再生成」という配線手順。
- `wiring_manifest.yml` の `when` / `require_one_of` 機構 (verify-wiring.sh) で co-change を検査できる。
- 既存 glob エンジンは `**` を「中間ディレクトリ 1 段以上」と解釈する。drizzle migration は `drizzle/` 直下にフラット生成されるため、`drizzle/**/*.sql` ではマッチせず `drizzle/*.sql` が正しい (synthetic test で検証)。
- synthetic worktree 検証: schema.ts 単独コミット → verify-wiring exit 1 / schema.ts + migration → exit 0。pyproject.toml 単独 → 新ルール fail / + Dockerfile → 新ルール OK。waiver (`.agent-evidence/wiring-waivers.txt`) でルールが WAIVED され緑になることも確認。

## General rule
宣言ファイル (schema / lock / manifest / 依存定義) を変更する PR では、それを実体化する派生成果物
(migration SQL / コンテナ image の依存 list / 生成コード) の共変更を co-change ゲートで要求する。
「typecheck 緑」「build 緑」は派生成果物が再生成された証拠ではない。
意図的に派生不要な変更 (コメント・version bump 等) は無期限 allowlist を作らず、
`.agent-evidence/wiring-waivers.txt` に rule id を 1 行書いて理由を証跡化する。

## Promotion status
- [x] Added wiring rule frontend-schema-needs-migration (wiring_manifest.yml)
- [x] Added wiring rule python-analyzer-pyproject-needs-dockerfile (wiring_manifest.yml)
- [x] verify-wiring.sh + hook + CI policy job で発火 (既存機構、追記のみで動作)
- [x] Recorded in rules/promoted/promoted.yml (frontend_schema_needs_migration / python_analyzer_pyproject_needs_dockerfile)
- [x] glob `**` のフラット非マッチを検証し `*.sql` に修正
- [ ] verify-wiring の glob `**` をゼロ段マッチに拡張するかは未決 (今回は narrow な `*.sql` で回避)
