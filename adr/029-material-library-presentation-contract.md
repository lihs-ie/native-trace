# Material library, material-detail and create presentation contract

ADR-029: 教材ライブラリ / 教材詳細 / 作成画面の表示契約（フィルタ配線・byline データ源・inert 廃止）

# Status

Proposed

2026-06-19 起票。v3 design gap 監査（`.agent-evidence/v3-design-gap-audit/gap-register.md` の cluster `library-material-detail-presentation`）が、発音解析エンジンを扱う既存 ADR-001〜023 のいずれもこの 3 画面の表示契約を所有していないことを確認した結果として新規に起こす。番号は 029 を採る（本 v3 設計ギャップ監査バッチで ADR-024〜030 を一括起票し、その 6 番目）。

# Context

ライブラリ（Screen 03, `applications/frontend/src/app/page.tsx`）・教材詳細（Screen 05, `applications/frontend/src/app/materials/[materialIdentifier]/page.tsx`）・作成（Screen 04, `applications/frontend/src/app/materials/new/page.tsx` とセクション作成 `applications/frontend/src/app/materials/[materialIdentifier]/sections/new/page.tsx`）の各画面は Claude Design リファレンス（gitignored `design-reference/`）から移植された。データ取得と作成フローは動作するが、表示契約を所有する ADR / `docs/specs` が存在しない。結果として複数のアフォーダンスが dead/inert であり、デザイン由来のいくつかのフィールドはデータ源を持たない。

コードで確認した具体的事実:

1. **フィルタピルが非対話**: `filterCounts`（`page.tsx:214-221`）はステータス別件数（`getMaterialStatus` が `noSections`/`noAttempts`/`practicing`/`completed` を返す、`page.tsx:159-163`）をライブに計算しているが、ピル自体は非対話の `<span className=\"fpill\">` で、先頭ピルに `is-active` がハードコードされている（`page.tsx:314`、ピル群は `page.tsx:313-326`）。画面の主たるフィルタ操作がグリッドをフィルタしない。フィルタ状態を持つ `useState`／`useMemo` は存在しない。
2. **カード byline が DEAD**: カードは `buildByLine(...)`（定義 `page.tsx:43-47`、呼び出し `page.tsx:332-335`）で `source` 由来の話者名/出典名を組み立てるが、一覧 API がこれらを送らない。`browse-practice-materials/index.ts` の `MaterialSummaryOutput`（`index.ts:33-40`）は `sourceType` のみを射影し（`toMaterialSummaryOutput` `index.ts:60-76`、入力 source 型が `{ sourceType: string } | null` で `index.ts:64`）、route handler は `source: m.sourceType ? { sourceType: m.sourceType } : null`（`api/v1/materials/route.ts:51` の GET map）で `speakerName`/`sourceTitle` を捨てる。`MaterialSourceDto`（`api-types.ts:6-11`）は両フィールドを宣言しているのに本番では常に欠落し、テストは mock した source 経由でのみ通る。
3. **カードの `.when` が `material.updatedAt` を表示**: `<span className=\"when\">{formatRelativeDate(material.updatedAt)}</span>`（`page.tsx:354`）。`MaterialStatsDto.lastPracticedAt`（`api-types.ts:24`、honest empty = null）が利用可能なのに「最終練習」ではなく更新日時を表示している。
4. **rendered-but-inert アクション**: ライブラリの load-sample ghost ボタン（`page.tsx:287`、handler なし）、セクション「編集」ボタン（detail `page.tsx:220-221`、handler なし）、「複製して編集」（detail `page.tsx:91-93`、handler なし）、セクション作成画面の「下書き保存」（`sections/new/page.tsx:205-207`、`disabled` でバックエンドに下書き概念なし）。
5. **データ scaffold だが render site なし**: 詳細画面「最近のアクティビティ」は静的な「記録なし」placeholder（`materials/[materialIdentifier]/page.tsx:321-332`）。per-attempt mini-sparkline も同様にデータ源がない。
6. **未モデルのデザイン要素**: 教材の accent/dialect チップ、byline の所属機関/年、版ごとの change-note、版ごとの attempt 件数、activity-log イベントモデルは `docs/03-detailed-design/domain.md` / `docs/05-database-design/database-design.md` のいずれにも存在しない（grep で accent/dialect・change-note・activity-log・institution は 0 hit）。版行の「初版」ラベルは最新版以外の全旧版にハードコード（detail `page.tsx:245`、`isCurrent ? \"\" : \"初版\"`）。
7. **CTA が録音状態でなく最新セクション存在で分岐**: `practiceHref = item.latestSection ? .../sections/${latest.identifier} : null`（detail `page.tsx:174,177-179`）。本文を持つが未録音のセクションでも「練習する」を出す。録音状態は `item.stats.recordingAttemptCount`（`SectionSeriesStatsDto`、`api-types.ts:61`）として既に届いており、`page.tsx:205` では「未録音」表示に使われている。

非欠陥（敵対的批評で確定済み・Must から除外）:

- 本文文字数上限と英字割合の閾値は `domain/section.ts:31-32`（`MAX_BODY_TEXT_LENGTH = 10000` / `MIN_ENGLISH_CHAR_RATIO = 0.3`）が正本であり、UI 側（`lib/body-validation.ts:10,13`）と一致する。セクション作成画面は既にこの実定数を import してカウンタ（`sections/new/page.tsx:11-13,34,37`）と妥当性チェックリスト（`lib/body-validation.ts:78-87`）に配線済み。デザインの 4000 字 / 60% は stale な旧図であり廃止された。
- `ScoreSpark`（`page.tsx:57`、呼び出し `page.tsx:360`）は履歴 1 件以下で spark を非表示にする honest-empty 実装であり、固定ダミーバー stub の意図的な置換である。欠陥ではない。

既存 ADR-001〜023 と `docs/specs/*.md` は GOP・espeak・採点・HVPT・golden-speaker・LLM coaching・remediation loop など解析エンジンのみを扱い、教材ライブラリのカード表示・フィルタ・版履歴描画・activity-log モデルを所有しない。したがってこれは misread でも build-only でもなく、新規の表示契約決定である。

# Decision

ライブラリ・教材詳細・作成の 3 画面の表示契約を本 ADR が所有する。各 gap について「(a) アフォーダンスを配線し裏付けデータ源を追加する」か「(b) デザイン要素を明示的に de-scope し dead binding/CSS を除去する」かを断定する。本 ADR は採点経路（ADR-004 が所有する threshold → severity → scoreImpact → ScoreSet）を一切変更しない純粋な表示契約である。

D1. **フィルタピルを配線する**。`page.tsx` に選択ピル状態（`useState<MaterialStatus | \"all\">`）を導入し、クリックで `mat-grid` のレンダリング集合をフィルタする。`is-active` は選択ピルを反映し、ハードコード先頭ピル（`page.tsx:314`）を廃止する。`filterCounts` は引き続きフィルタ前の全集合を数える。

D2. **カード `.when` を `stats.lastPracticedAt` に束ねる**。`material.updatedAt` への束縛（`page.tsx:354`）を廃止し、`lastPracticedAt` を表示する。`null`（未練習）のとき「未練習」相当の明示的な not-started フォールバックラベルを出す。

D3. **byline のデータ源を契約に通す**。`browse-practice-materials` の `MaterialSummaryOutput` に `speakerName`/`sourceTitle`（nullable）を追加し、`toMaterialSummaryOutput`（`index.ts:60-76`）の入力 source 型を拡張して `material.source` から射影する。`api/v1/materials/route.ts:51` の GET map を `source: m.sourceType || m.speakerName || m.sourceTitle ? { sourceType, speakerName, sourceTitle } : null` 相当に拡張し、`MaterialSourceDto`（既に両フィールドを宣言）と整合させる。これにより byline が本番でも mock なしに実 source 属性をレンダリングする。

D4. **rendered-but-inert アクションを残さない**（AGENTS.md agent-policy 準拠）。load-sample ghost ボタン・セクション「編集」ボタン・「複製して編集」ボタン・「下書き保存」ボタンは、各々を実 route/usecase に配線するか DOM から除去する。本 ADR の first slice では既存の実フロー（教材作成 `/materials/new`、セクション作成 `/materials/[id]/sections/new`、練習 `/sections/[sectionId]`）に到達点があるもの以外は DOM 除去する: load-sample・「複製して編集」・「下書き保存」は除去する。セクション「編集」ボタンは、本文改訂（新版作成）用 usecase `revise-practice-section` が `PATCH /api/v1/section-series/[sectionSeriesIdentifier]`（`route.ts:22`）として実在し real entrypoint を持つため、編集 UI（既存本文をプリフィルして PATCH を投げるフォーム）へ配線するか、本 slice で UI を起こさない場合は DOM 除去する。いずれにせよ、現存しない `sections/new?series=...` クエリ経由の配線は採らない（`sections/new/page.tsx:47` は `POST /section-series` の新規シリーズ作成のみで `series` クエリを読まない）。除去・配線のいずれにせよ inert placeholder は残さない。

D5. **activity-log / mini-sparkline を de-scope する**。activity-log read model も per-version attempt 集計も domain/database に存在しないため、本 first slice では両者を明示的に de-scope し、scaffold CSS を除去して honest-empty 状態（「アクティビティの記録はまだありません」相当の明示テキスト）に置く。静的「記録なし」を data scaffold の上に置く現状（`materials/[materialIdentifier]/page.tsx:321-332`）は不可。read model の追加は将来 ADR で別途決定する（# Notes 参照）。

D6. **未モデルフィールドを de-scope する**。accent/dialect チップ・byline 所属機関/年・版ごと change-note・版ごと attempt 件数はデータ源が committ されていないため dead CSS/ラベルを除去する。版行「初版」ラベルの全旧版ハードコード（detail `page.tsx:245`）を除去し、版番号のみを表示する。

D7. **CTA を録音状態で分岐する**。セクションの「練習する／録音する」分岐を `item.latestSection` 存在（detail `page.tsx:174,177-179`）ではなく `item.stats.recordingAttemptCount > 0`（録音状態、`api-types.ts:61`）で決める。本文を持つが未録音のセクションは「録音する」を出す。

D8. **検証閾値と honest-empty を正本として明記する**。本文文字数上限 10000 字・英字割合 0.30 を `domain/section.ts:31-32` 由来の正本とし、デザインの 4000 字 / 60% は stale で破棄されたと記録する。`ScoreSpark`（`page.tsx:57`）の honest-empty（履歴 1 件以下で非表示）は意図された挙動であり gap ではないと記録する。

# Contract changes

本 ADR の唯一のクロスレイヤ契約変更は D3（byline データ源）であり、TypeScript 層内（usecase ↔ route ↔ UI DTO）に閉じる。python-analyzer schema（`applications/python-analyzer/src/python_analyzer/interface/schema.py`）/ Haskell ToJSON は採点・解析経路のみを扱い、教材一覧 source 属性に関与しないため変更なし。

- **TS usecase**: `applications/frontend/src/usecase/browse-practice-materials/index.ts` の `MaterialSummaryOutput`（現 `index.ts:33-40`）に `speakerName: string | null` と `sourceTitle: string | null` を追加。`toMaterialSummaryOutput`（`index.ts:60-76`）の入力 source 型を現 `{ sourceType: string } | null`（`index.ts:64`）から `{ sourceType: string; speakerName?: string | null; sourceTitle?: string | null } | null` に拡張し、両フィールドを `?? null` で射影。
- **TS api-types + 整合**: `applications/frontend/src/lib/api-types.ts:6-11` の `MaterialSourceDto` は既に `sourceTitle?: string | null` / `speakerName?: string | null` を宣言済みで型追加は不要。`api/v1/materials/route.ts:51` の GET response source 構築式を `speakerName`/`sourceTitle` を含むよう変更し、`MaterialSourceDto` と実 wire payload を一致させる。
- **TS zod**: 一覧取得は読み取りのため request 側 zod 変更なし。POST 側（`api/v1/materials/route.ts:68` の `postBodySchema`）は既に `speakerName`/`sourceTitle` を optional/nullable で受け付けており（`route.ts:74-75`）変更なし。

D1/D2/D4-D7 は表示ロジックのみで DTO/契約に影響しない。

# Alternatives considered

採用: **画面別に「配線」か「de-scope」を個別判定する hybrid**（D1-D8）。フィルタと byline と CTA は安価かつ既存データ/usecase で配線でき UX 価値が高い一方、activity-log・version-attempt 集計・accent/dialect は新規データモデルを要し low-priority スコープに不相応なため de-scope する。inert は AGENTS.md 準拠で一律排除する。

不採用: **全デザイン要素を忠実に配線する（activity-log read model + version change-note + accent/dialect モデルを domain/database に追加）**。理由: cluster は low priority であり、activity-log イベントモデルと版別 attempt 集計は `domain.md`/`database-design.md` に存在しない新規ドメイン設計を要する。表示契約 ADR で大きなデータモデル決定を抱き込むと決定の焦点が散る。これらは必要になった時点で別 ADR で決める（# Notes）。

不採用: **inert をそのまま残し「将来配線予定」とコメントで明記する**。理由: AGENTS.md agent-policy は rendered-but-inert placeholder を本番経路に残すことを禁ずる（`verify-no-stub-placeholder` / reviewer rubric）。「将来配線」コメントは未配線完了報告の温床であり棄却。

不採用: **byline を残したまま usecase 拡張をせず mock 前提のテストだけ通す現状維持**。理由: 本番で常に欠落する dead binding であり honest-empty ですらない（要素は出るが内容が常に欠落）。D3 で配線するか要素を除去するかの二択しかない。

不採用（D4 セクション編集の配線先）: **`sections/new?series=...` クエリ経由で新版作成フローへ配線する**。理由: `sections/new/page.tsx:47` は `POST /section-series`（新規シリーズ作成）のみで `series` クエリを読まないため、この URL は本文改訂 entrypoint ではない。採用案は実在する `PATCH /api/v1/section-series/[sectionSeriesIdentifier]`（`route.ts:22`, `revise-practice-section` usecase）へ配線するか、本 slice で UI を起こさず DOM 除去するかの二択とする。

# Consequences

## Positive

- ライブラリの主フィルタが実際に機能し、`.when` が「最終練習」を正しく示し、byline が本番で実データを表示するため、3 画面の表示が「見えているもの = 実データ」になる。
- inert アフォーダンスが消え、AGENTS.md no-placeholder ポリシーに適合する。reviewer rubric / `verify-no-stub-placeholder` が green になる。
- 検証閾値（10000/0.30）と honest-empty を正本として固定するため、stale なデザイン図（4000/60%）由来の偽 gap が今後の監査で再提起されない。
- 採点経路に触れないため ADR-004 の scoreImpact 不変条件を機械的に保つ。

## Negative

- activity-log・version change-note・accent/dialect を de-scope するため、デザインリファレンスにある一部のリッチ表示が当面再現されない（honest-empty として明示）。将来再導入時は別 ADR とデータモデル追加が必要。
- D3 で usecase output / route map / DTO 整合を跨ぐ変更が入り、`browse-practice-materials` のユニットテスト fixture を実 wire 形（`speakerName`/`sourceTitle` 込み）に更新する必要がある。
- D4 のセクション「編集」を改訂フロー（`PATCH /api/v1/section-series/[sectionSeriesIdentifier]`）へ配線する場合、編集 UI を新規に起こす必要がある。本 slice でその UI を起こさない場合は DOM 除去に倒す（どちらでも inert は残さない）。

# Compliance

agent-policy: 各 Must は real public entrypoint（App Router 画面 / Route Handler / usecase）から到達可能かつ観測可能挙動で assert する。本番経路に mock/stub/fake/placeholder を入れない。`verify-no-prod-doubles` / `verify-no-stub-placeholder` / `verify-wiring` を green にし、`.agent-evidence/`（commands.txt / wiring-map.json / completion-report.md）を更新する。本 ADR は表示専用であり、scoreImpact を変えない（ADR-004 の threshold→severity→scoreImpact→ScoreSet は worker に閉じたまま、`Scoring.hs:1285-1289` の `severityToScoreImpact`（Critical=-8.0 / Major=-5.0 / Minor=-2.0 / Suggestion=0.0）は不変、frontend は messageJa 充填と識別子割当のみ）ことを assert する。

受入条件（番号付き・testable）:

1. **フィルタ配線（D1）**: `app/page.tsx` をコンポーネントテストで開き、`materials.length > 0` の状態で「練習中」ピルをクリックすると、`mat-grid` のレンダリングカード集合が `getMaterialStatus(stats) === \"practicing\"` の教材のみになり、`is-active` クラスが「練習中」ピルに移ること、`filterCounts` の各数値はフィルタ前の全集合のまま不変であることを assert する。`page.tsx:314` のハードコード `is-active` を持つ `<span>` が残っていないことを assert する。
2. **`.when` 束縛（D2）**: `page.tsx` のカードレンダリングテストで `stats.lastPracticedAt` が非 null の教材は `formatRelativeDate(lastPracticedAt)` を表示し、`lastPracticedAt === null` の教材は not-started フォールバックラベルを表示すること、`material.updatedAt` を `.when` に渡す経路（旧 `page.tsx:354`）が存在しないことを assert する。
3. **byline 契約（D3）**: usecase `browsePracticeMaterials` のユニットテストで、入力 material の `source.speakerName`/`source.sourceTitle` が `MaterialSummaryOutput` に射影されることを assert する。`GET /api/v1/materials`（`route.ts:19`、real Route Handler entrypoint）のテストで、source を持つ教材の JSON レスポンスに `source.speakerName` / `source.sourceTitle` が含まれることを、mock した usecase ではなく実 usecase + テストリポジトリ経由で assert する。
4. **inert 排除（D4）**: `app/page.tsx` / detail `page.tsx` / `sections/new/page.tsx` を走査し、handler/route を持たない load-sample（旧 `page.tsx:287`）・「複製して編集」（旧 detail `page.tsx:91-93`）・「下書き保存」（旧 `sections/new/page.tsx:205-207`）ボタンが DOM に存在しないことをコンポーネントテストで assert する。セクション「編集」ボタン（旧 detail `page.tsx:220-221`）は、(i) `onClick`/`href` を持たない inert な状態では DOM に存在しないこと、(ii) 配線する場合は `revise-practice-section` の実 entrypoint（`PATCH /api/v1/section-series/[sectionSeriesIdentifier]`）に到達する編集 UI へ遷移する実 handler を持つこと、のいずれかを assert する。`verify-no-stub-placeholder` が当該ファイルで green。
5. **activity / sparkline de-scope（D5）**: detail `page.tsx` テストで「最近のアクティビティ」（旧 `page.tsx:321-332`）が静的「記録なし」placeholder ではなく明示的 honest-empty テキストを表示し、mini-sparkline の data scaffold（render site なし CSS 束縛）が除去されていることを assert する。
6. **未モデルフィールド de-scope（D6）**: detail `page.tsx` テストで accent/dialect チップ・byline 所属機関/年・版別 change-note/attempt 件数の dead CSS/ラベルが存在せず、版行が「初版」ハードコード（旧 detail `page.tsx:245`）を持たず版番号のみを表示することを assert する。
7. **CTA 状態分岐（D7）**: detail `page.tsx` テストで、本文を持つが `item.stats.recordingAttemptCount === 0` のセクションが「録音する」を、`recordingAttemptCount > 0` のセクションが「練習する」を表示することを assert する（`item.latestSection` 存在のみでの分岐が残っていないこと）。
8. **閾値・honest-empty 正本（D8）**: `domain/section.ts` のユニットテストで本文 10000 字超が `validationFailed`、英字割合 0.30 未満が `validationFailed` になることを assert し、`lib/body-validation.ts` の `MAX_BODY_TEXT_LENGTH === 10000`（`:10`）/ `MIN_ENGLISH_CHAR_RATIO === 0.3`（`:13`）を assert する。`ScoreSpark` テストで履歴 ≤ 1 件のとき spark バーが描画されない（honest-empty）ことを assert する。デザインの 4000/60% は本 ADR で stale と記録されており再導入されない。
9. **採点不変条件（ADR-004）**: 本 ADR の変更前後で assessment 経路（worker の scoreImpact / ScoreSet）に差分がないことを、scoring 関連テスト（worker / response-mapper）が変更なしで green のまま通ることで assert する。frontend は引き続き scoreImpact を生成・改変しない。

# Notes

- 本 ADR は表示契約のみを所有し、採点・解析経路（ADR-001/002/004 ほか）には一切触れない。
- 開いた問い（将来 ADR で決定。本 ADR では de-scope）: (a) activity-log read model（analysis/revision/creation イベント）のドメイン/DB 設計、(b) per-version change-note と per-version attempt 集計の永続化、(c) 教材の accent/dialect 属性のドメインモデル化。これらは `docs/03-detailed-design/domain.md` / `docs/05-database-design/database-design.md` に現状存在せず、必要になった時点でデータモデル ADR として起こす。
- 開いた問い: D4 のセクション「編集」を本 slice で配線するか DOM 除去で倒すか。配線する場合の到達先は実在する `PATCH /api/v1/section-series/[sectionSeriesIdentifier]`（`revise-practice-section` usecase）であり、編集 UI を新規に起こす実装コストとの兼ね合いで判断する。`sections/new?series=...` は実在しない経路のため採らない。
- D3 の usecase fixture は実 wire 形（`speakerName`/`sourceTitle` 込み）で更新し、合成正値だけで偽 green にしない（memory: unit-fixtures-must-mirror-real-worker-shape の精神に従う）。
