# Per-phoneme acoustic-phonetic diagnosis: formant / spectral / VOT measurement over forced-alignment boundaries

ADR-018: 音響音声学的診断（フォルマント / スペクトル重心 / VOT）と articulatory-direction 契約

# Status

Accepted

2026-06-18 承認（リポジトリオーナーが grill セッションで深掘り診断スコープのうち「音響特徴の半分」を本 ADR に確定。Q3 で acoustic features を AAI より先に出すと決定。AAI 側は別 ADR）。

# Context

現状の所見（finding）は GOP（`Scoring.hs:gopMajorThreshold = -12.0` / `gopMinorThreshold = -8.0`）と nBest 混同セット照合だけを根拠に出している。「GOP が低い」「上位候補が別音素」までは分かるが、**学習者の調音が目標からどの方向にずれているか**（舌が高すぎる / 後ろすぎる / 摩擦が弱い / 帯気が長すぎる）を所見が一切運んでいない。そのため How（直し方）が常に音素汎用テンプレートに落ち、ADR-004 の structured-diff 契約が運ぶ「target vs measured の比較」は IPA 文字列の差分どまりで、音響的な実測比較を欠く。

調査（acoustic-feature 調査・area「per-phoneme acoustic-phonetic diagnosis」）で次が確定した:

1. python-analyzer には既に parselmouth（GPL-3.0, ADR-006 境界内）が `infrastructure/parselmouth_prosody.py` に配線済みで、`extract_f0_contour` は `_decode_samples`（soundfile→ffmpeg フォールバック）→ `parselmouth.Sound(numpy, sampling_frequency)` のパターンで動く。`to_formant_burg()` は同じ install に含まれ、`get_value_at_time(n, t)` は無声フレームで NaN を返す。
2. 強制整列境界 `AlignmentBoundary`（start_ms / end_ms）は `analyze_pronunciation.py:65`（`boundaries`）で prosody 呼び出し（:97）より前に既に scope 内にある。`pcm_bytes` は `_extract_pcm_bytes` で :95 に抽出される。音響計測はこの :95 と :97 の間に差し込める。
3. 母音フォルマント参照値は公開済み（Hillenbrand 1995 JASA 97(5):3099-3111, vowdata.ds が公開）。F1↓=舌高 / F2↑=舌前 / F3↓=円唇・r 音性 の対応付け（Ladefoged & Johnson, A Course in Phonetics 7th）は確立している。
4. /s/ 対 /ʃ/ はスペクトル重心（Jongman 2000 JASA）で分離可能（重心 >~4500Hz=/s/ 寄り、<~3500Hz=/ʃ/ 寄り、要話者較正）。/r/ 対 /l/ は F3（男性で /r/ は F3<2000Hz、/l/ は F3>2500Hz; staRt app / Shriberg 2017 PMC6050150）。
5. **重要な落とし穴**（調査 risks）:
   - LPC/Burg フォルマント推定は ~50ms 未満の有声区間で不安定（窓 25ms × 2-3 窓必要）。短い縮約母音・閉鎖区間で NaN/暴れる。
   - **/v/ 対 /b/ を VOT で測るのは誤り**。/v/ は唇歯摩擦音であって閉鎖音ではない。VOT は閉鎖音専用。/v/-/b/ の弁別は摩擦エネルギー比（1-4kHz の非周期エネルギー / 総エネルギー）で測る。
   - 話者の声道長正規化（性別・年齢）なしに生 Hz を Hillenbrand 男性ノルムへ直接比較すると、女性・子ども話者で F1/F2 が一律高く出て偽陽性になる。現状 `AudioInput` / `AnalysisMetadata` に話者性別がない（既存 `StimulusMetadata.speakerSex`（ADR-009, schema.py:255）は HVPT 刺激メタデータ専用で、解析リクエストの話者性別とは別物）。
   - `analyze_pronunciation.py:_estimate_word_boundaries` は等分割ヒューリスティックで単語境界精度が限定的（ただし音素境界自体は forced alignment 由来で正確）。

ADR-004 は「worker が scoring を所有し、analyzer は生計測のみ返す。worker は structured-diff（messageJa=null）を返し、frontend が messageJa を埋める」と定めている。本 ADR はこの分業を厳守する: analyzer は**生の音響計測値**まで（採点・判定・偏差導出なし）を返し、目標ノルムからの偏差判定と方向ラベル導出は worker の `Scoring.hs`（しきい値＝scoring policy）が行い、articulatory-direction の自然文化は frontend の messageJa 生成に委ねる。worker は方向ラベルを structured-diff の追加証拠フィールドとして透過する（scoring policy／scoreImpact は不変）。

# Decision

**D1 — analyzer に per-phoneme 音響計測ポート method を追加する（measurement-only、採点・偏差導出なし）。** `usecase/ports.py` の `ProsodyPort` Protocol に `measure_phoneme_acoustics(audio_bytes: bytes, boundaries: tuple[AlignmentBoundary, ...], sample_rate: int) -> tuple[PhonemeAcousticMeasurement, ...]` を追加する。Protocol は構造的なので、実装漏れがあれば型エラーで落ちる（agent-policy: wire-first を型で強制）。実装は新規 `infrastructure/parselmouth_formant.py` に置き、`parselmouth_prosody.py` の遅延 import（try/except ImportError で空フォールバック）と `_decode_samples`（soundfile→ffmpeg）パターンを踏襲する。`prosody_analyzer.py` の `ProsodyAnalyzer` に method を生やし、`parselmouth_formant.py` へ委譲する。analyzer は生 Hz・母音長・スペクトル重心のみ返し、ノルム比較・偏差・方向判定は一切しない（D5 で worker 所有）。

**D2 — 計測アルゴリズム（parselmouth を一度だけ呼び、境界中点でサンプリング）。** `to_formant_burg` を発話全体で **1 回**呼び（per-phoneme で呼ばない＝レイテンシ抑制、調査 risk「multiple parselmouth calls multiply latency」対策）、各 `AlignmentBoundary` の中点秒で `formants.get_value_at_time(n, midpoint_s)` を n=1,2,3 で取る。NaN は除外し該当 Hz を None にする。

呼び出しは次のとおり（2 つの引数を取り違えないこと）:
`sound.to_formant_burg(time_step=0.005, max_number_of_formants=5, maximum_formant=<ceiling_hz>, window_length=0.025, pre_emphasis_from=50)`
- `max_number_of_formants` は**抽出するフォルマント本数（count）で常に 5**（性別に依存しない定数）。
- `maximum_formant` は**フォルマント探索の上限周波数（Hz の天井）**で、`speakerSex` が `'F'`（女性、声道短＝フォルマント高め）のとき **6500Hz**、`'M'` または `'unknown'` のとき **5500Hz**（調査 Option C: 男性 5500 / 女性 6500）。

すなわち性別条件で変えるのは `maximum_formant`（Hz 天井）であって `max_number_of_formants`（本数）ではない。`max_number_of_formants` を 6500 にするのは誤り（本数指定に Hz を入れることになる）。

スペクトル重心は scipy/numpy（parselmouth 不要）で当該区間の `centroid = sum(f*P(f))/sum(P(f))`。

**D3 — 短区間ガード。** 各音素区間が **40ms 未満**のとき `to_formant_burg` の結果サンプリングを行わず f1/f2/f3=None を返す（調査 recommendation 6、LPC 不安定回避。`to_formant_burg` 自体は発話全体で 1 回呼ぶので、ガードはサンプリング段で効かせる）。スペクトル重心は 30ms 以上で計算、未満は None。母音長は境界差分なので常に算出。

**D4 — 母音参照ノルムと正規化。** Hillenbrand 1995（vowdata.ds 公開値）の General American 母音 F1/F2/F3 平均を、worker 側の偏差判定で参照できるよう **worker `Scoring.hs`** に static map `hillenbrandGaVowelFormants :: Map (Text, Text) (Double, Double, Double)`（key=(ipa, sex)、sex は 'F'|'M'）としてエンコードし、ソースコメントに JASA 1995 を引用する（analyzer は生 Hz のみ返すので、ノルム表は偏差を計算する worker 側に置く）。代表値（男性 'M', hVd）: /iː/ (270,2290,3010) / /ɪ/ (430,2070,2950) / /æ/ (660,1720,2600) / /ɑ/ (730,1090,2440) / /uː/ (300,870,2240)。**正規化**: `speakerSex` が 'M'|'F' なら性別別ノルム行を使う。'unknown' のときは発話内 Lobanov z-score（当該録音で検出した全母音 F1/F2 の平均・SD で z 化し、ノルム側も同様に z 化して比較）。母音が 3 個未満で正規化不能のときは偏差を None にして方向判定をスキップ（偽陽性回避）。

**D5 — 偏差は計測値から worker が導出、方向ラベルも worker。** analyzer は生 Hz + 母音長 + スペクトル重心まで（生計測）を返す。**目標ノルムからの偏差と articulatory-direction の方向ラベル導出は Haskell worker の `Scoring.hs` で行う**（しきい値判定 = scoring policy、ADR-004 で worker 所有）。worker は finding に `acousticEvidence`（後述 D7）を載せる。方向ラベルの規則（Ladefoged & Johnson 7th、調査 evidence/recommendation 7）:
- F1 が正規化後ノルム +1.0 SD 超（母音の場合）→ `tongueHeight = "tooLow"`（舌が低すぎ＝開きすぎ）、−1.0 SD 未満 → `"tooHigh"`、範囲内 → `"ok"`。
- F2 が +1.0 SD 超 → `tongueBackness = "tooFront"`、−1.0 SD 未満 → `"tooBack"`、範囲内 → `"ok"`。
- /r/ で F3 ≥ 2000Hz（男性）/ ≥ 2300Hz（女性）→ `rhoticity = "insufficient"`（r 音性不足、tap 化の疑い）。
- /l/ で F3 < 2500Hz → `rhoticity = "overRetroflex"`。**閾値 2500Hz は調査 evidence（/l/ は F3>2500Hz）に合わせ、/r/ 判定の 2000Hz とは非対称に設定する**（/r/ は F3<2000、/l/ は F3<2500）。2000–2500Hz の帯域はどちらの強い指標にも該当しないが、/r/ 期待音素では `insufficient`（F3≥2000）が、/l/ 期待音素では `overRetroflex`（F3<2500）が発火するため、期待音素ごとに一意に決まり dead zone は生じない。
- /s/ 期待でスペクトル重心 < 3500Hz → `sibilantPlace = "tooPalatal"`（/ɕ/ 化）、/ʃ/ 期待で > 4500Hz → `"tooAlveolar"`。
- 母音長: tense 期待（/iː/,/uː/）で長さが lax ノルム比 1.4 未満 → `vowelLength = "tooShort"`（調査 evidence、ratio-based が絶対 ms より頑健）。
しきい値（SD 倍率・Hz 境界・長さ比）は `Scoring.hs` に **calibratable 定数**として置く（GOP しきい値と同じ場所・方針）。

**D6 — 自然文は frontend。** worker の方向ラベル（enum）から messageJa を作るのは frontend の `ImprovementMessageGenerator`（ADR-004 / ADR-017 と同じ分担）。例: `tongueHeight="tooLow"` + 母音 /iː/ → 「舌をもっと高く、口蓋に近づけてください（英語 /iː/ は日本語のイより舌が高い）」。worker は自然文を持たない。

**D7 — 契約デルタ（後述 contractChanges に厳密記載）。** analyzer→worker→finding に音響情報を通す。analyzer は生計測（`phonemeAcoustics`）を返し、worker が偏差判定して finding に `acousticEvidence`（方向ラベル + 実測/目標フォルマント）を載せる。これは ADR-004 structured-diff の「target vs measured 比較」を音響実測で具体化する追加証拠であり、減点ロジックは変えない（scoreImpact は GOP 由来のまま、ADR-004 不変）。**音響偏差は減点しない**（GOP が既に減点済み。二重減点回避）。acousticEvidence は presentation/advice 用の付帯証拠。

**D8 — フェーズ順（incremental landing）。** Phase 0: 母音長（parselmouth 不要、境界差分、`vowelLength` 方向のみ）。Phase 1: 母音 F1/F2/F3 + Lobanov 正規化 + `tongueHeight`/`tongueBackness`。これが本 ADR の最小スライス。Phase 2 以降（同契約上の追加計測、別スライス）: スペクトル重心 /s/-/ʃ/ → F3 /r/-/l/ → 閉鎖音 VOT（/b/-/p/ 等。**/v/-/b/ は VOT ではなく摩擦エネルギー比**）。

**D9 — first slice（A/B partial playback + re-record GOP delta）との関係。** 本 ADR は closed-loop first slice の**前提でも依存でもない**。first slice は GOP delta だけで閉じる。acousticEvidence は re-record 後の「方向が改善したか」（例 F1 が目標方向に動いた）を将来 delta 表示に足せる拡張点として設計するが、first slice の必須スコープ外。本 ADR は deeper-diagnosis の独立スライスとして並走する。

# Contract changes

- **python-analyzer domain/measurement.py**: 新規 frozen dataclass `PhonemeAcousticMeasurement(phoneme: str, start_milliseconds: int, end_milliseconds: int, f1_hz: float | None, f2_hz: float | None, f3_hz: float | None, spectral_centroid_hz: float | None, duration_milliseconds: int)` を追加。外部依存なしの純 dataclass。`RawMeasurementResult` に `phoneme_acoustics: tuple[PhonemeAcousticMeasurement, ...] = field(default_factory=tuple)` を追加（既存フィールド順末尾、後方互換）。VOT/摩擦エネルギーは Phase 2 で `vot_ms: float | None` / `frication_energy_ratio: float | None` を同 dataclass に追加予定（本 ADR スライスでは追加しない）。
- **python-analyzer usecase/ports.py ProsodyPort**: Protocol に method 追加: `def measure_phoneme_acoustics(self, audio_bytes: bytes, boundaries: tuple[AlignmentBoundary, ...], sample_rate: int) -> tuple[PhonemeAcousticMeasurement, ...]: ...`。構造的 Protocol なので実装漏れは型エラー。
- **python-analyzer infrastructure/parselmouth_formant.py (新規)**: `extract_phoneme_acoustics(audio_bytes, boundaries, sample_rate, maximum_formant_hz) -> tuple[PhonemeAcousticMeasurement, ...]` を実装。parselmouth_prosody.py の遅延 import + _decode_samples を踏襲。`sound.to_formant_burg(time_step=0.005, max_number_of_formants=5, maximum_formant=maximum_formant_hz, window_length=0.025, pre_emphasis_from=50)` を 1 回呼ぶ。`max_number_of_formants` は本数で常に 5、`maximum_formant` は Hz 天井で呼び出し側から渡す（性別 'F'→6500、それ以外→5500; D2）。境界中点で get_value_at_time(1..3) を取得、NaN/40ms 未満は None。生 Hz のみ返し、ノルム比較・偏差はしない（measurement-only）。parselmouth import はこのファイル内のみ（ADR-006 境界・ast-grep 対象内）。
- **python-analyzer infrastructure/prosody_analyzer.py ProsodyAnalyzer**: `measure_phoneme_acoustics(audio_bytes, boundaries, sample_rate)` method を実装し、`speakerSex` から maximum_formant_hz（'F'→6500、'M'|'unknown'→5500）を決めて parselmouth_formant.extract_phoneme_acoustics へ委譲。
- **python-analyzer usecase/analyze_pronunciation.py execute()**: prosody_port が非 None の分岐内、:95 の `pcm_bytes = _extract_pcm_bytes(audio)` と :97 の f0_contour 呼び出しの間に `phoneme_acoustics = self._prosody.measure_phoneme_acoustics(pcm_bytes, boundaries, sample_rate)` を追加し、`RawMeasurementResult(...)` 構築に `phoneme_acoustics=phoneme_acoustics` を渡す。boundaries は既に :65 で scope 内、pcm_bytes は :95 で抽出済み。
- **python-analyzer interface/schema.py**: 新規 `PhonemeAcousticResponse(BaseModel)`: `phoneme: str`, `startMs: int`, `endMs: int`, `f1Hz: float | None`, `f2Hz: float | None`, `f3Hz: float | None`, `spectralCentroidHz: float | None`, `durationMs: int`（全 camelCase, C1/C2 wire 契約）。`AnalysisResponse` に `phonemeAcoustics: list[PhonemeAcousticResponse] = Field(default_factory=list)` を追加。解析リクエストの `AnalysisMetadata` に `speakerSex: str = Field(default="unknown", description="話者性別: 'F' / 'M' / 'unknown'")` を optional 追加。**値集合は既存 `StimulusMetadata.speakerSex`（schema.py:255, ADR-009）および stimulus/domain.py:149 の `Literal["F","M","unknown"]` と一致させる**（ファイル内で 'male'/'female' 系の第二規約を作らない）。Hillenbrand ノルム参照の sex key も 'F'|'M' に統一する。
- **python-analyzer app.py analyze() handler**: `RawMeasurementResult.phoneme_acoustics` を `[PhonemeAcousticResponse(...) for m in result.phoneme_acoustics]` にマップし AnalysisResponse(phonemeAcoustics=...) に渡す（perPhonemeGop マッピングと同パターン、:198 付近）。composition root（build_use_case）は変更不要（既存 ProsodyAnalyzer がそのまま新 method を持つ）。
- **backend AnalyzerClient.hs**: 新規 `data PhonemeAcoustic = PhonemeAcoustic { acousticPhoneme :: Text, acousticStartMs :: Int, acousticEndMs :: Int, acousticF1Hz :: Maybe Double, acousticF2Hz :: Maybe Double, acousticF3Hz :: Maybe Double, acousticSpectralCentroidHz :: Maybe Double, acousticDurationMs :: Int }` + FromJSON（f1Hz/f2Hz/f3Hz/spectralCentroidHz は `.:?`）。`AnalyzerResult` に `analyzedPhonemeAcoustics :: [PhonemeAcoustic]` を追加し FromJSON で `o .:? "phonemeAcoustics" .!= []`（旧 analyzer 後方互換）。export list に `PhonemeAcoustic (..)` を追加。
- **backend Types.hs AssessmentFinding**: 新規 `data AcousticEvidence = AcousticEvidence { acousticTongueHeight :: Maybe Text, acousticTongueBackness :: Maybe Text, acousticRhoticity :: Maybe Text, acousticSibilantPlace :: Maybe Text, acousticVowelLength :: Maybe Text, acousticMeasuredF1Hz :: Maybe Double, acousticMeasuredF2Hz :: Maybe Double, acousticMeasuredF3Hz :: Maybe Double, acousticTargetF1Hz :: Maybe Double, acousticTargetF2Hz :: Maybe Double, acousticTargetF3Hz :: Maybe Double }` + ToJSON（wire key: tongueHeight/tongueBackness/rhoticity/sibilantPlace/vowelLength/measuredF1Hz/measuredF2Hz/measuredF3Hz/targetF1Hz/targetF2Hz/targetF3Hz）。`AssessmentFinding` に `findingAcousticEvidence :: Maybe AcousticEvidence` を追加し ToJSON object に `"acousticEvidence" .= findingAcousticEvidence finding`。方向ラベルは小文字 enum 文字列（tooHigh|tooLow|ok / tooFront|tooBack|ok / insufficient|overRetroflex|ok / tooPalatal|tooAlveolar|ok / tooShort|ok）。export list に `AcousticEvidence (..)`。
- **backend Scoring.hs**: Hillenbrand GA 母音ノルムを static map `hillenbrandGaVowelFormants :: Map (Text, Text) (Double, Double, Double)`（key=(ipa, sex)、sex='F'|'M'、ソースコメントに JASA 1995 引用）として追加。buildGopFinding に、当該音素の `analyzedPhonemeAcoustics` を IPA + 時間境界（startMs/endMs 一致、同 IPA 重複時は index）で突き合わせ AcousticEvidence を導出するヘルパー `deriveAcousticEvidence`（calibratable 定数: ACOUSTIC_F1_SD_THRESHOLD=1.0, ACOUSTIC_F2_SD_THRESHOLD=1.0, RHOTIC_F3_MALE_HZ=2000, RHOTIC_F3_FEMALE_HZ=2300, LATERAL_F3_OVERRETROFLEX_HZ=2500, SIBILANT_S_CENTROID_HZ=4500, SIBILANT_SH_CENTROID_HZ=3500, TENSE_LAX_DURATION_RATIO=1.4）を追加。`findingAcousticEvidence = deriveAcousticEvidence ...` を設定。**scoreImpact は変更しない**（音響偏差は減点しない、D7）。発話内 Lobanov 正規化（speakerSex='unknown' 時）のための母音集合は analyzedPhonemeAcoustics 全体から fullVowelPhonemes（Scoring.hs:902）で抽出して算出。speakerSex は AnalyzerResult 経由で渡す（'F'|'M'|'unknown'）。
- **frontend acl/pronunciation-assessment/oss-worker/schema.ts**: `findingSchema` に `acousticEvidence` を optional+nullable で追加: `z.object({ tongueHeight: z.enum(["tooHigh","tooLow","ok"]).nullable().optional(), tongueBackness: z.enum(["tooFront","tooBack","ok"]).nullable().optional(), rhoticity: z.enum(["insufficient","overRetroflex","ok"]).nullable().optional(), sibilantPlace: z.enum(["tooPalatal","tooAlveolar","ok"]).nullable().optional(), vowelLength: z.enum(["tooShort","ok"]).nullable().optional(), measuredF1Hz: z.number().nullable().optional(), measuredF2Hz: z.number().nullable().optional(), measuredF3Hz: z.number().nullable().optional(), targetF1Hz: z.number().nullable().optional(), targetF2Hz: z.number().nullable().optional(), targetF3Hz: z.number().nullable().optional() }).nullable().optional().transform(v => v ?? null)`。response-mapper.ts でそのまま EngineFindingDto へ転写。
- **frontend lib/api-types.ts EngineFindingDto**: `acousticEvidence: AcousticEvidenceDto | null` を追加。新規 type `AcousticEvidenceDto = { tongueHeight: "tooHigh"|"tooLow"|"ok" | null; tongueBackness: "tooFront"|"tooBack"|"ok" | null; rhoticity: "insufficient"|"overRetroflex"|"ok" | null; sibilantPlace: "tooPalatal"|"tooAlveolar"|"ok" | null; vowelLength: "tooShort"|"ok" | null; measuredF1Hz: number | null; measuredF2Hz: number | null; measuredF3Hz: number | null; targetF1Hz: number | null; targetF2Hz: number | null; targetF3Hz: number | null }`。
- **frontend usecase/port/improvement-message-generator.ts + acl/improvement-message/rule-based**: `ImprovementMessageGeneratorInput` に `acousticEvidence: AcousticEvidenceDto | null` を追加し、run-assessment-job の generate/generateFeedbackLayers 呼び出しに findingDraft.acousticEvidence を渡す。rule-based 生成器の howJa に方向ラベル→日本語 articulatory 文（D6 例）を分岐追加（articulation-data.ts の既存 steps を方向ラベルで上書き）。これは ADR-004 の messageJa=frontend 生成分担を守る。

# Alternatives considered

- **A: 母音フォルマント（F1/F2/F3）+ 母音長のみを第一フェーズで実装（子音対立は後続）** — Pros: 信頼性が最も高い。LPC/Burg を持続時間が十分（>50ms）かつ有声連続の母音区間だけに適用。Hillenbrand 1995 ノルムを直接使える。F1 偏差→舌高、F2 偏差→舌前後、の articulatory-direction を確立した対応表で生成可能。実装は新規 parselmouth_formant.py に ~150 行。Cons: 日本語学習者で最も機能負荷が高い /r/-/l/（子音対立）をカバーしない。母音長は AlignmentBoundary から計算できるが文脈正規化が必要。不採用理由: 棄却ではなく採用。ただし Phase 0 として母音長（parselmouth 不要、境界差分のみ）→ Phase 1 母音フォルマント →（後続 ADR/スライス）スペクトル重心 /s/-/ʃ/ → F3 /r/-/l/ → VOT 閉鎖音、の段階順に組み込む。本 ADR は契約と Phase 0+1 を確定し、子音側は同契約上の追加計測として定義する。
- **B: 全 5 特徴（F1/F2/F3 + スペクトル重心 + /r/-/l/ F3 + VOT + 母音長）を一括で本 ADR スライスに実装** — Pros: 診断が一度で完全になる。Cons: 短区間 LPC 不安定・話者正規化欠如・/v/-/b/ の VOT 誤適用という 3 つの落とし穴を一度に抱える。VOT/摩擦エネルギーは閉鎖音/摩擦音の境界検出（burst/voicing onset）が追加で必要で、forced-alignment の ±20ms 粒度（wav2vec2 stride）で精度が落ちる。不採用理由: 棄却。リスクを段階的に切らずまとめると、最初のスライスで偽陽性を出して「音響診断は当てにならない」という評価を招く。信頼性順（母音長→母音フォルマント→スペクトル重心→F3→VOT）で incremental に出す（調査 recommendations の phased order）。
- **C: 偏差→articulatory-direction の文言化を Haskell worker（scoring/advice 層）に置く** — Pros: 調査 recommendation 7 は「F-to-articulation mapping は static lookup で worker の advice 層に属する（python-analyzer は measurement-only）」と述べる。worker が finding を組むので所見と同じ場所で完結する。Cons: ADR-004 は messageJa を frontend が生成すると定める。worker に articulatory 自然文を持たせると messageJa=null 契約と二重管理になる。worker は方向ラベル（enum）までに留め、自然文は frontend という分担が ADR-004 と整合する。不採用理由: 部分採用。worker は偏差の**方向ラベル**（`tongueHeight: tooHigh|tooLow|ok` 等の機械可読 enum）を導出して finding に載せるが、**自然文（messageJa）は frontend が生成**する。measurement（python：生 Hz のみ）／direction 導出（worker のしきい値判定）／自然文（frontend）の三分担で ADR-004 を保つ。
- **D: 話者性別を必須入力にして Hillenbrand 性別別ノルムを引く** — Pros: 正規化が単純（性別別ノルム行を直引き）。Cons: 現状 `AudioInput` / 解析リクエスト `AnalysisMetadata` に性別がなく、UI 収集動線もない。必須化は録音フローを壊す。不採用理由: 棄却。第一フェーズは **発話内 Lobanov z-score 正規化**（同一録音内の全母音 F1/F2 の平均・SD で各母音を z 化）を性別非依存フォールバックとして採用する（調査 recommendation 2/evidence Lobanov 1971）。性別は解析リクエストの `AnalysisMetadata.speakerSex` を **optional**（既存コードベース慣習に合わせ `'F'|'M'|'unknown'`、既定 `'unknown'`）で追加し、与えられたら性別別ノルムを使い、なければ発話内正規化に倒す。値集合は ADR-009 の `StimulusMetadata.speakerSex`（`Literal["F","M","unknown"]`, stimulus/domain.py:149）と同一にして、ファイル内 2 規約併存（'male'/'female' 系）を避ける。

# Consequences

## Positive

- 所見が IPA 差分だけでなく『舌が低すぎる/前すぎる/r 音性不足』という調音方向の実測証拠を運ぶ。How が音素汎用テンプレートから学習者の実発話に即した指示へ具体化する（ADR-004 structured-diff の target-vs-measured を音響実測で裏付け）。
- analyzer は measurement-only（生 Hz のみ）、worker が偏差判定＋方向ラベル（しきい値判定=scoring policy）、frontend が自然文、の三分担で ADR-004/ADR-017 の責務境界を維持する。新フィールドは全て optional+nullable で旧 analyzer / 旧 worker と後方互換（FromJSON `.:?`、zod `.optional()`）。
- parselmouth を 1 回だけ呼び境界中点でサンプリングするので、既存 F0 計測（< 0.5s）と同等のレイテンシ追加に収まる。母音長（Phase 0）は parselmouth 不要で境界差分のみ。
- speakerSex の値集合を既存コードベース慣習（'F'/'M'/'unknown'、stimulus/domain.py:149 / schema.py:255）に統一したことで、Hillenbrand 性別別ノルムの key 突き合わせがファイル内で一意になり、規約二重化由来のバグを排除した。
- フェーズ順（母音長→母音フォルマント→重心→F3→VOT）で信頼性の高い特徴から段階投入でき、短区間 LPC 不安定・話者正規化欠如・/v/-/b/ VOT 誤適用の落とし穴を一度に抱えない。

## Negative

- 音響偏差は減点しない設計（GOP が既に減点済み・二重減点回避）なので、acousticEvidence は presentation/advice のみに効く。スコアには直接寄与しない。
- 話者性別 metadata が無い場合の発話内 Lobanov 正規化は、母音 3 個未満の短い録音（単語 1 語 retry 等）で正規化不能になり偏差を None にする。short-utterance では方向診断が出ないことがある。
- parselmouth GPL-3.0 の利用範囲が parselmouth_formant.py に広がる。ADR-006 の境界（python-analyzer 内のみ・配布時 GPL 再評価）が引き続き適用され、新ファイルも ast-grep `no-parselmouth-outside-python-analyzer` の対象内（applications/python-analyzer/** は ignores 済み）。
- Hillenbrand ノルムは hVd 文脈・特定話者集団由来で、連結発話の縮約母音や非ネイティブの調音には完全一致しない。偏差は『方向の目安』であって絶対値の正否ではない。
- /l/ overRetroflex の F3<2500Hz と /r/ insufficient の F3<2000Hz は閾値が非対称。期待音素ごとに判定経路が分かれるため運用上は一意だが、同一音響値が期待音素により異なるラベルになる点は較正時に意識が要る。

# Compliance

- contract test: analyzer の `AnalysisResponse` が `phonemeAcoustics` を含み、各エントリが f1Hz/f2Hz/f3Hz/spectralCentroidHz を null 許容で持つことを assert。40ms 未満の音素区間で f1/f2/f3 が None になることを fixture で assert。
- contract test: `to_formant_burg` 呼び出しで max_number_of_formants=5（定数）かつ maximum_formant が speakerSex='F' で 6500、'M'/'unknown' で 5500 になることを parselmouth_formant の unit test で assert（D2 引数取り違え回帰防止）。
- contract test: 解析リクエスト `AnalysisMetadata.speakerSex` が 'F'|'M'|'unknown' のみを受理し、既定 'unknown' であることを assert。Hillenbrand ノルム key が 'F'|'M' であり 'male'/'female' を含まないことを assert（規約統一の回帰防止）。
- contract test: worker `AssessmentFinding` ToJSON が `acousticEvidence` キーを出し、方向ラベルが定義 enum 値（tooHigh|tooLow|ok 等）のみであることを assert。AcousticEvidence の wire 形を frontend zod findingSchema が parse できることを schema-and-response-mapper.test.ts で assert。
- policy test: scoreImpact が acousticEvidence の有無で変わらないこと（音響偏差は減点しない、二重減点なし）を Scoring の ScoringSpec で assert。GOP しきい値（-12/-8）と severity→scoreImpact（-5/-2）が不変であることを既存テストで維持。
- label test: /r/ で F3=2200Hz（2000–2500 帯）のとき rhoticity='insufficient'、/l/ で F3=2200Hz のとき rhoticity='overRetroflex' になり、期待音素ごとにラベルが一意に決まる（dead zone なし）ことを deriveAcousticEvidence の unit test で assert。
- fitness: `no-parselmouth-outside-python-analyzer` ast-grep ルールが parselmouth_formant.py の parselmouth import を許容（applications/python-analyzer/** ignores）し、frontend/worker への import を引き続き禁止することを CI で確認。
- runtime-verify: /r/ を含む実録音（例 'right'）を live worker→analyzer に通し、acousticEvidence.rhoticity が出ること、/iː/ を短く発話した録音で vowelLength='tooShort' が観測されることを live で assert（unit fixture でなく実 worker 出力で検証、MEMORY『unit fixture は実 worker 出力形で書く』に従う）。
- 正規化検証: 話者性別未指定（'unknown'）の録音で母音 3 個以上のとき発話内 Lobanov 正規化が走り、3 個未満で偏差が None になることを assert（偽陽性ガード）。

# Notes

- Risks:
  - 短区間 LPC 不安定: 50ms 未満の有声区間（縮約母音・閉鎖区間）で to_formant_burg のサンプリングが NaN/不安定値になる。40ms 未満ガード（D3）で大半を防ぐが、40-50ms の母音は値が出ても信頼性が低い。confidence を下げるか方向判定を保守的にする余地を残す（calibratable）。
  - 話者正規化の限界: 発話内 Lobanov は母音多様性が低い録音（同一母音の繰り返し等）で SD が小さく z-score が暴れる。解析リクエスト側の性別 metadata 収集動線が UI に無い現状、'unknown' 経路が default で、偏差の絶対精度は限定的（方向の目安に留まる）。
  - /v/-/b/ を VOT で測る実装が後続フェーズで混入するリスク: /v/ は摩擦音で VOT 不適用（調査 risk 明記）。Phase 2 で VOT を足す際は閉鎖音限定とし、/v/-/b/ は摩擦エネルギー比で別経路にすることを本 ADR で明文化。誤実装は ScoringSpec の phenomenon 別アサートで検出する。
  - D2 引数取り違え回帰: max_number_of_formants（本数=5）と maximum_formant（Hz 天井=5500/6500）は別パラメータ。Hz を本数側に渡す誤実装を contract test（compliance 2 項目目）で固定する。
  - speakerSex 規約逸脱回帰: 解析リクエストに 'male'/'female' を入れる誤実装で Hillenbrand key（'F'/'M'）と突き合わせが外れ偏差が常に None になる。値集合 assert（compliance 3 項目目）で固定する。
  - forced-alignment の ±20ms 粒度（wav2vec2 stride）が短い子音の境界中点をずらし、フォルマント/重心サンプリング点が隣接音素に入る恐れ。母音（80-150ms）では影響小だが、子音フェーズ（Phase 2 以降）では境界精度が診断精度の上限になる。
  - pedagogy 証拠の限界（SLA 調査 RISK-2）: 調音可視化（articulatory 方向文）は音響フィードバックと併置されてはじめて効く（Kocjancic 2025）。本 ADR の方向文は finding の音声（TTS お手本 / 部分再生）と同画面で提示される前提。方向文だけ単独提示は教育効果の独立エビデンスが無い点を frontend 提示設計で守る必要がある。
  - 二重減点の取り違え: 将来 acousticEvidence を減点に使う改修が入ると GOP と二重減点になる。D7（音響偏差は減点しない）を policy test で固定する。
- First-slice relevance: 本 ADR は closed-loop first slice（A/B partial playback + in-place re-record → GOP delta → improvement 表示）の前提でも依存でもない。first slice は GOP delta だけで閉じ、acousticEvidence を必要としない。両者は並走する独立スライスで、本 ADR は deeper-diagnosis（音響特徴の半分）を担う。接点は将来拡張のみ: re-record 後に『フォルマントが目標方向へ動いたか』を delta 表示へ足せる設計上の余地を D9 で残すが、それは first slice の必須スコープ外。実装順は first slice（closed-loop minimal）を優先し、本 ADR の Phase 0（母音長, parselmouth 不要）→ Phase 1（母音フォルマント）は first slice と独立に着手できる。
- Amends:
  - ADR-004: structured-diff 契約に `acousticEvidence`（方向ラベル + 実測/目標フォルマント）を追加。worker が scoring を所有する分担は不変。音響偏差は減点せず（GOP 由来の scoreImpact は不変）、acousticEvidence は presentation/advice 用の付帯証拠として messageJa 生成（frontend）に渡す。analyzer は引き続き measurement-only（生 Hz のみ返し、偏差判定はしない）。
  - ADR-006: parselmouth の利用範囲を infrastructure/parselmouth_formant.py（新規）に拡張。GPL-3.0 境界（python-analyzer 内のみ・配布時再評価）の判断は不変で、新ファイルも同境界・同 ast-grep ルール対象内。境界判断の再評価は不要。
  - ADR-009: ADR-009 が定義する HVPT 刺激メタデータの `StimulusMetadata.speakerSex`（'F'/'M'/'unknown'）とは別に、解析リクエスト `AnalysisMetadata.speakerSex` を新設する（同じ値集合 'F'/'M'/'unknown' を再利用）。ADR-009 のフィールド・意味は変更しない。本 ADR は値集合の規約を ADR-009 と一致させることだけを宣言する（ファイル内 2 規約併存の回避）。
- Depends on: ADR-001, ADR-002, ADR-004, ADR-005, ADR-006, ADR-009
- Author: lihs
- Approval date: 2026-06-18
- Approver: リポジトリオーナー（セッション内）
- Last updated: 2026-06-18
- Related: ADR-001（GOP / forced-alignment 境界の供給元）、ADR-002（espeak / IPA 音素列）、ADR-004（worker scoring 所有・structured-diff 契約・messageJa=frontend 生成。本 ADR が acousticEvidence を追加証拠として拡張）、ADR-005（python-analyzer アーキテクチャ境界）、ADR-006（parselmouth GPL-3.0 境界。本 ADR が parselmouth_formant.py に拡張）、ADR-009（StimulusMetadata.speakerSex 値集合 'F'/'M'/'unknown' の原典）、ADR-017（ImprovementMessageGenerator / messageJa 生成分担の確立）。
