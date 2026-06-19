# epenthesis フィードバックの契約と減点方針を確定する

ADR-017: epenthesis 母音挿入フィードバックの契約と減点

# Status

Accepted

2026-06-18 承認（リポジトリオーナーがセッション内 AskUserQuestion で D1 severity を「減点対象に昇格」と
決定。D2–D4 はその確定判断から導かれるエンジニアリング契約）。

# Context

実機テスト（単語 "this"）で epenthesis（母音挿入）所見の What/観測 が
**「this」という母音が挿入されています** という無意味な文を出した。"this" は単語であって母音ではない。
これは "this" 固有ではなく、epenthesis 所見が出るたびに必ず起きる。

根本原因の連鎖:

1. python analyzer の `syllable.py`（112-132 付近）は**音節数の不一致**で epenthesis を検出するが、
   **どの母音が挿入されたかを同定せず** `insertedVowels` を空で返す。
2. Haskell worker（`Scoring.hs:551-553`）は `insertedVowels` が空のため
   `insertedVowelIpa = Nothing`、`insertionMs = Nothing` を emit する（worker と wire 自体は
   `findingInsertedVowel` / `insertionPositionMs` を運ぶ配線になっている。`Types.hs:329-330`）。
   検出語は `detected.text = 単語名`（`Scoring.hs:569-573` 付近）。
3. frontend のルールベース生成器
   （`applications/frontend/src/acl/improvement-message/rule-based/create-rule-based-improvement-message-generator.ts:88`）
   は `const vowel = input.insertedVowel ?? detectedDisplay` とし、`insertedVowel` が null のとき
   **detected（= 単語）にフォールバック**して `「${vowel}」という母音が挿入されています`（:90）を出す。
   よって 「this」という母音 になる。

付随して見つかった欠陥:

- **diagnostic 経路の取り違え**: `applications/frontend/src/usecase/complete-diagnostic-session/index.ts:261`
  が worker の `insertion` も `epenthesis` に再マップする（:260 の `epenthesis: "epenthesis"` に続けて
  `insertion: "epenthesis"`）。本物の挿入誤りまで同じ壊れたテンプレートに流れる。
- **位置情報の取りこぼし**: worker は `insertionPositionMs` を emit する（`Types.hs:330`）が、frontend の
  oss-worker schema / `EngineFindingDto` / response-mapper がこれを取り込まず、挿入位置が境界で落ちる。
- **severity の不整合**: epenthesis は `category=pronunciation` で `severity=Major` / `scoreImpact=-5.0`
  を付与され、ADR-004 の connectedSpeech compliance check を回避している。一方 ADR-004 の減点
  allow-list（body-range-pinned deductions）は `substitution` / `omission` / `insertion` のみで、
  epenthesis は減点対象として明記されていない。
- **テスト欠落**: `ScoringSpec.hs:195-212` は `phenomenon == "epenthesis"` しか assert せず、
  severity / scoreImpact / `insertedVowel == Nothing` 経路を守っていない。

# Decision

**D1 — epenthesis を減点対象に昇格し、ADR-004 の allow-list を拡張する。** epenthesis は明瞭性に
関わる segmental/phonotactic 誤り（既存 Why が Tajima et al.「時間構造補正で明瞭性 +19pt」を引く）で
あり、`substitution` / `omission` / `insertion` と並ぶ**減点対象**とする。ADR-004 の body-range-pinned
deductions allow-list に `epenthesis` を追加し、`category=pronunciation`・`severity=Major`・
`scoreImpact=-5.0`（calibratable）を正規化する。これにより現状の category 回避（connectedSpeech
チェックをすり抜ける）をやめ、allow-list に列挙された減点対象として compliance test を正当に通す。

**D2 — メッセージ契約: worker が挿入母音 + 位置を供給し、frontend は単語にフォールバックしない。**
python analyzer の `syllable.py` が、detected IPA と expected 音素列の差分から**挿入母音の phoneme と
位置**を同定し `insertedVowels`（phoneme + positionMs）を populate する（Haskell worker と wire は既に
`findingInsertedVowel` / `findingInsertionPositionMs` を運ぶので、analyzer 側を埋めれば末端まで届く）。
frontend の epenthesis メッセージは**挿入母音 + 位置**を明示する（例: 「<word> の語末に母音 /ɯ/ が
挿入されています」）。`?? detectedDisplay` の**単語フォールバックを廃止**し、母音が同定できないときは
位置ベースの汎用文（例: 「<word> に余分な母音が入っています（カタカナ読み混入の傾向）」）を出す。
**単語を母音として名指す文を二度と生成しない。**

**D3 — diagnostic 経路の取り違えを修正する。** `complete-diagnostic-session` は worker の `insertion`
を `insertion` にマップする（`epenthesis` にしない）。insertion と epenthesis は別の現象である。

**D4 — 位置データを frontend 契約に通す。** frontend の oss-worker schema / `EngineFindingDto` /
response-mapper に `insertionPositionMs` を追加し、D2 の位置メッセージを構築可能にする（worker は既に
emit 済み、現状 frontend 境界で落ちている）。

# Alternatives considered

- **frontend のみの汎用文（worker 無改修・単語を絶対に名指さない）— 主修正としては棄却。** 具体性・
  actionability が低い。ただし D2 の **null フォールバック経路**として採用する（母音が同定できないとき）。
- **epenthesis を presentation-only / severity=suggestion / scoreImpact=0 にする（ADR-004 の
  connected-speech 扱い）— 棄却。** owner が減点対象を選択。epenthesis は明瞭性に関わる segmental 誤り。
- **`category=pronunciation` の回避を継続 — 棄却。** allow-list に epenthesis を正規追加して compliance
  test を正当に通す方が誠実。

# Consequences

- epenthesis 所見が「<word>」という母音 ではなく、挿入母音 + 位置（または位置ベース汎用文）を出す。
  ユーザーが何を直すか分かる = 改善を促せる。
- ADR-004 を拡張する（worker は引き続き scoring と status を所有。本 ADR は減点 allow-list に epenthesis を
  加え、structured-diff に挿入母音 + 位置を確実に運ばせる。frontend は引き続き messageJa を埋めるだけ）。
- 本物の `insertion` 所見が epenthesis に化けなくなる。
- ADR-001 の GOP/検出経路は不変。

# Compliance

- 変更点: analyzer `syllable.py`（挿入母音 + 位置の同定）、frontend のメッセージ生成器（単語フォールバック
  廃止 + 位置文）、frontend ACL（schema/EngineFindingDto/response-mapper に `insertionPositionMs`）、
  diagnostic usecase（insertion→insertion）、worker/frontend の severity/scoreImpact 正規化。
- worker scoring 契約（ADR-004）: epenthesis を減点 allow-list に追加。`messageJa` は引き続き frontend 生成。
- テスト追加: `ScoringSpec.hs` が epenthesis の severity/scoreImpact と「挿入母音あり/なし」両経路を assert。
  frontend 生成器テストが epenthesis メッセージで**母音/位置を名指し、単語を名指さない**ことを assert。
- ランタイム検証: epenthesis 誤りを含む実録音を live worker に通し、messageJa が挿入母音 + 位置（または
  汎用位置文）であり 「<word>」という母音 でないこと、`insertion` が epenthesis に再ラベルされないこと、
  epenthesis が allow-list 整合の減点を持つことを観測 assert する。

# Notes

- `scoreImpact = -5.0` は既存 Major 値を踏襲（calibratable）。calibration の結果でより軽い減点
  （例 Minor / -2.0）に変える余地は残す。確定値は実装時に記録する。
- **Non-goal:** epenthesis 検出アルゴリズム（音節数 VAD）の信頼性改善、他 phenomenon
  （substitution/linking/flap/weakForm/lexicalStress 等）メッセージの一括棚卸し、ADR-001 の GOP 検出変更。
- Author: lihs
- Approval date: 2026-06-18
- Approver: リポジトリオーナー（セッション内）
- Last updated: 2026-06-18
- Related: ADR-004（worker が scoring を所有・structured-diff・減点 allow-list。本 ADR が allow-list を
  拡張）、ADR-001（GOP / detected IPA の供給元）、ADR-002（espeak / IPA）。
- Amended 2026-06-18（pronunciation-remediation batch）: ADR-020（決定論 How バックボーン）が substitution / omission / insertion 系の How バリアント分岐を補完する。本 ADR の epenthesis 位置文契約とは衝突しない（本 ADR は epenthesis 単体の What / 位置、ADR-020 は How 層全体のバリアント分岐）。本 ADR で発生した response-mapper の `insertionPositionMs` 取りこぼしの教訓として、新フィールドは必ず mapper に配線する方針を ADR-018 / 019 / 020 / 022 が踏襲する。
