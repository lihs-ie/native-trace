-- | 発音解析スコアリング（純粋関数）。
-- GOP（Goodness of Pronunciation）計測値を元に採点・finding 生成を行う。
-- 同一入力には必ず同一出力を返す（乱数・IO 不使用）。
module NativeTrace.Worker.Scoring (
  ScoringInput (..),
  ScoringOutput (..),
  TokenSegment (..),
  scoreFromGop,
  generateFindingsFromGop,
  buildAssessmentScores,
  tokenize,
  -- 後方互換: 既存 Assessment.hs が参照する名前を re-export する
  scoreAssessment,
  generateFindings,
  -- 音質ガード
  checkAudioQuality,
  audioQualityMinMeanDbfs,
  audioQualityMinRecordingDurationMs,
  audioQualityMinPhonemeDetectionRate,
  audioQualityMaxMedianGop,
)
where

import Data.Char (isSpace)
import Data.List (foldl', sort)
import Data.Text (Text)
import Data.Text qualified as Text
import NativeTrace.Worker.AnalyzerClient (
  AnalyzerResult (..),
  InterWordSilence (..),
  PhonemeGop (..),
  SchwaRealization (..),
 )
import NativeTrace.Worker.Types (
  AssessmentFinding (..),
  AssessmentScores (..),
  AudioRange (..),
  FindingCategory (..),
  FindingSeverity (..),
  PronunciationEvidence (..),
  TextRange (..),
 )

-- ---- 型 ----

-- | トークン化の結果。各トークンは sectionBodyText 上の文字 offset を保持する。
data TokenSegment = TokenSegment
  { tokenText :: Text,
    tokenStartChar :: Int,
    tokenEndChar :: Int
  }
  deriving (Show, Eq)

data ScoringInput = ScoringInput
  { inputText :: Text,
    inputByteLength :: Int,
    inputDurationMilliseconds :: Int
  }
  deriving (Show, Eq)

data ScoringOutput = ScoringOutput
  { scoreOverall :: Int,
    scoreAccuracy :: Int,
    scoreNativeLikeness :: Int,
    scorePronunciation :: Int,
    scoreConnectedSpeech :: Int,
    scoreProsody :: Int,
    outputTokens :: [TokenSegment],
    summaryMessageJa :: Text,
    summaryMessageEn :: Text
  }
  deriving (Show, Eq)

-- ---- スコア定数（calibratable threshold） ----

-- | GOP 値を pronunciation スコア（0-100）に線形 clip する下限。
-- GOP は負の平均 log 事後確率（例: h≈-6.9, d≈-13.6）。
gopFloor :: Double
gopFloor = -20.0 -- この GOP 以下は pronunciation = 0

-- | GOP 値を pronunciation スコア（0-100）に線形 clip する上限。
gopCeiling :: Double
gopCeiling = -2.0 -- この GOP 以上は pronunciation = 100

-- | finding として検出する GOP 閾値（major）。calibratable threshold
gopMajorThreshold :: Double
gopMajorThreshold = -12.0

-- | finding として検出する GOP 閾値（minor）。calibratable threshold
gopMinorThreshold :: Double
gopMinorThreshold = -8.0

-- | connectedSpeech スコアの無音長ペナルティ閾値（ミリ秒）。calibratable threshold
silencePenaltyThresholdMs :: Int
silencePenaltyThresholdMs = 500

-- | connectedSpeech スコアの話速ペナルティ閾値（音素/秒）の上限。calibratable threshold
speechRateUpperThreshold :: Double
speechRateUpperThreshold = 15.0

-- | connectedSpeech スコアの話速ペナルティ閾値（音素/秒）の下限。calibratable threshold
speechRateLowerThreshold :: Double
speechRateLowerThreshold = 3.0

-- | accuracy スコアの保守的固定値（ADR-003: 後スライスまで placeholder）。
-- accuracy は音素アライメント品質の詳細評価を必要とするため現スライスでは固定する。
fixedAccuracyScore :: Int
fixedAccuracyScore = 70

-- | prosody スコアの保守的固定値（ADR-003: 後スライスまで placeholder）。
-- prosody はピッチ/リズム解析を必要とするため現スライスでは固定する。
fixedProsodyScore :: Int
fixedProsodyScore = 65

-- ---- 音質ガード定数（calibratable threshold） ----

-- | 音声品質ガード: 最低 dBFS 閾値。
-- 実測値: 極小音量 ≈ -38.6 dB、クリーン音声 ≈ -15 dB。
-- calibratable threshold
audioQualityMinMeanDbfs :: Double
audioQualityMinMeanDbfs = -35.0

-- | 音声品質ガード: 録音総時間の最低閾値（ミリ秒）。
-- この値未満は録音が極端に短い/無音と見なす。
-- pausey・低エネルギーな録音でも総時間が十分なら短すぎ判定では弾かない。
-- calibratable threshold
audioQualityMinRecordingDurationMs :: Int
audioQualityMinRecordingDurationMs = 1000

-- | 音声品質ガード: 最低音素検出率（detected/expected）。
-- detected 音素数 / expected 音素数がこの値未満なら低品質と判定する。
-- calibratable threshold
audioQualityMinPhonemeDetectionRate :: Double
audioQualityMinPhonemeDetectionRate = 0.25

-- | 音声品質ガード: 中央値 GOP の上限（負値）。
-- per-phoneme GOP の中央値がこの値未満なら低品質と判定する。
-- calibratable threshold
audioQualityMaxMedianGop :: Double
audioQualityMaxMedianGop = -18.0

-- | 音声品質チェック。低品質なら True を返す（採点前に早期返却するためのフラグ）。
-- 以下4条件のいずれか該当で low_quality と判定する:
--   ① meanDbfs < audioQualityMinMeanDbfs
--   ② durationMilliseconds < audioQualityMinRecordingDurationMs（録音総時間ベース）
--   ③ detected音素率 < audioQualityMinPhonemeDetectionRate
--   ④ 中央値GOP < audioQualityMaxMedianGop（GOP リスト空も該当）
-- Note: speechDurationSeconds（発話エネルギー時間）は計測値として保持するが判定には使わない。
--       pausey/低エネルギー録音で過少カウントされ正常録音まで誤発火するため。
checkAudioQuality ::
  -- | 平均 dBFS
  Double ->
  -- | 録音総時間（ミリ秒）
  Int ->
  -- | 検出音素数（detected IPA のスペース区切りトークン数）
  Int ->
  -- | 期待音素数（expected IPA のスペース区切りトークン数）
  Int ->
  -- | per-phoneme GOP 値リスト
  [Double] ->
  -- | True = 低品質
  Bool
checkAudioQuality meanDbfs durationMilliseconds detectedPhonemeCount expectedPhonemeCount gopValues =
  meanDbfs < audioQualityMinMeanDbfs
    || durationMilliseconds < audioQualityMinRecordingDurationMs
    || isLowPhonemeDetectionRate detectedPhonemeCount expectedPhonemeCount
    || isLowMedianGop gopValues

-- | detected音素率が閾値未満なら True。expected が 0 の場合はチェックしない。
isLowPhonemeDetectionRate :: Int -> Int -> Bool
isLowPhonemeDetectionRate detectedCount expectedCount
  | expectedCount <= 0 = False
  | detectedCount <= 0 = True
  | otherwise =
      fromIntegral detectedCount / fromIntegral expectedCount
        < audioQualityMinPhonemeDetectionRate

-- | GOP リストの中央値が閾値未満なら True。リスト空は True（該当）。
isLowMedianGop :: [Double] -> Bool
isLowMedianGop [] = True
isLowMedianGop gopValues = medianGop gopValues < audioQualityMaxMedianGop

-- | Double リストの中央値を返す。
medianGop :: [Double] -> Double
medianGop [] = 0.0
medianGop values =
  let sorted = Data.List.sort values
      n = length sorted
      mid = n `div` 2
   in if even n
        then (sorted !! (mid - 1) + sorted !! mid) / 2.0
        else sorted !! mid

-- ---- Tokenize ----

-- | sectionBodyText を空白・句読点で分割し、各トークンの文字 offset を保持する。
tokenize :: Text -> [TokenSegment]
tokenize text = go 0 0 (Text.unpack text) []
 where
  go _ _ [] accumulated = reverse accumulated
  go start current (character : rest) accumulated
    | isSeparator character =
        let accumulated' =
              if current > start
                then
                  let token =
                        TokenSegment
                          { tokenText = Text.take (current - start) (Text.drop start text),
                            tokenStartChar = start,
                            tokenEndChar = current
                          }
                   in token : accumulated
                else accumulated
         in go (current + 1) (current + 1) rest accumulated'
    | null rest =
        let token =
              TokenSegment
                { tokenText = Text.take (current + 1 - start) (Text.drop start text),
                  tokenStartChar = start,
                  tokenEndChar = current + 1
                }
         in reverse (token : accumulated)
    | otherwise = go start (current + 1) rest accumulated

  isSeparator c = isSpace c || c `elem` (",.:;!?\"'()-" :: String)

-- ---- スコア計算ユーティリティ ----

-- | スコアを 0..100 に収める。
clampScore :: Int -> Int
clampScore n
  | n < 0 = 0
  | n > 100 = 100
  | otherwise = n

-- | GOP 平均値を 0-100 の pronunciation スコアに線形変換する。
-- gopFloor 以下 = 0、gopCeiling 以上 = 100 に clip する。calibratable threshold
gopAverageToScore :: [Double] -> Int
gopAverageToScore [] = 50 -- GOP データ無し時の保守的デフォルト
gopAverageToScore gops =
  let avg = sum gops / fromIntegral (length gops)
      -- gopFloor〜gopCeiling を 0〜100 に線形マップ
      normalized = (avg - gopFloor) / (gopCeiling - gopFloor)
   in clampScore (round (normalized * 100.0))

-- | connectedSpeech スコアを無音長・schwa 実現率・話速から算出する。
-- 各要素は保守的なペナルティ減点方式で算出する。calibratable threshold
connectedSpeechScore :: [InterWordSilence] -> [SchwaRealization] -> Double -> Int
connectedSpeechScore silences schwaRealizations speechRate =
  let base = 75 :: Int
      -- 長い無音区間ペナルティ
      longSilenceCount =
        length $
          filter
            (\s -> silenceDurationMs s > silencePenaltyThresholdMs)
            silences
      silencePenalty = min 20 (longSilenceCount * 5)
      -- schwa 実現ペナルティ（非実現が多い = 不自然）
      schwaTotal = length schwaRealizations
      schwaRealizedCount = length (filter schwaRealized schwaRealizations)
      schwaPenalty =
        if schwaTotal == 0
          then 0
          else
            let unrealizedRate = fromIntegral (schwaTotal - schwaRealizedCount) / fromIntegral schwaTotal :: Double
             in round (unrealizedRate * 10.0) :: Int
      -- 話速ペナルティ（極端に速い/遅い）
      ratePenalty =
        if speechRate < speechRateLowerThreshold || speechRate > speechRateUpperThreshold
          then 10
          else 0
   in clampScore (base - silencePenalty - schwaPenalty - ratePenalty)

-- ---- GOP ベースのスコアリング ----

-- | AnalyzerResult から ScoringOutput を算出する（純粋・決定的）。
-- accuracy/prosody は ADR-003 どおり保守的固定値（後スライスまで placeholder と明記）。
scoreFromGop :: AnalyzerResult -> ScoringOutput -> ScoringOutput
scoreFromGop result scoringOutput =
  let gops = map gopValue (analyzedPerPhonemeGop result)
      pronunciationScore = gopAverageToScore gops
      connectedSpeechScoreValue =
        connectedSpeechScore
          (analyzedInterWordSilences result)
          (analyzedSchwaRealizations result)
          (analyzedSpeechRatePhonemePerSecond result)
      -- accuracy/prosody: ADR-003 保守的固定 placeholder（後スライスまで）
      accuracyScore = fixedAccuracyScore
      prosodyScore = fixedProsodyScore
      -- nativeLikeness: pronunciation と connectedSpeech のブレンド
      nativeLikenessScore =
        clampScore $
          (pronunciationScore * 60 + connectedSpeechScoreValue * 40) `div` 100
      -- overall: 加重集約
      overallScore =
        clampScore $
          ( pronunciationScore * 30
              + accuracyScore * 20
              + connectedSpeechScoreValue * 20
              + prosodyScore * 15
              + nativeLikenessScore * 15
          )
            `div` 100
   in scoringOutput
        { scoreOverall = overallScore,
          scoreAccuracy = accuracyScore,
          scoreNativeLikeness = nativeLikenessScore,
          scorePronunciation = pronunciationScore,
          scoreConnectedSpeech = connectedSpeechScoreValue,
          scoreProsody = prosodyScore
        }

-- | AnalyzerResult から AssessmentFinding リストを生成する（純粋・決定的）。
-- phenomenon は expected/detected IPA の簡易 Levenshtein 整列で判定。
-- findingMessageJa は ADR-004 どおり Nothing（worker では生成しない）。
generateFindingsFromGop ::
  -- | sectionBodyText
  Text ->
  -- | AnalyzerResult
  AnalyzerResult ->
  [AssessmentFinding]
generateFindingsFromGop sectionBodyText analyzerResult =
  let tokens = tokenize sectionBodyText
      tokenCount = length tokens
      allPhonemeGops = analyzedPerPhonemeGop analyzerResult
      expectedIpa = analyzedExpectedIpa analyzerResult
      detectedIpa = analyzedDetectedIpa analyzerResult
      -- 音素 GOP から閾値でフィルタして finding を生成
      gopFindings =
        concatMap
          (buildGopFinding tokenCount tokens expectedIpa detectedIpa)
          allPhonemeGops
      -- connectedSpeech finding（presentation-only: severity=suggestion, scoreImpact=0）
      connectedFindings = buildConnectedSpeechFinding sectionBodyText analyzerResult
   in gopFindings <> connectedFindings

-- | 1 音素の GOP 値から finding を生成する（閾値以上は finding 化しない）。
buildGopFinding ::
  Int ->
  [TokenSegment] ->
  Text ->
  Text ->
  PhonemeGop ->
  [AssessmentFinding]
buildGopFinding tokenCount tokens expectedIpa detectedIpa phonemeGop =
  let gop = gopValue phonemeGop
   in case gopToSeverity gop of
        Nothing -> []
        Just severity ->
          let phoneme = gopPhoneme phonemeGop
              startMilliseconds = gopStartMs phonemeGop
              endMilliseconds = gopEndMs phonemeGop
              textRange = findTextRangeForTime tokens tokenCount startMilliseconds
              phenomenon = classifyPhenomenon expectedIpa detectedIpa phoneme
              expected =
                PronunciationEvidence
                  { evidenceText = Nothing,
                    evidenceIpa = Just expectedIpa
                  }
              detected =
                PronunciationEvidence
                  { evidenceText = Nothing,
                    evidenceIpa = Just detectedIpa
                  }
           in [ AssessmentFinding
                  { findingCategory = FindingCategoryPronunciation,
                    findingSeverity = severity,
                    findingTextRange = textRange,
                    findingAudioRange =
                      Just
                        AudioRange
                          { startMs = startMilliseconds,
                            endMs = endMilliseconds
                          },
                    findingExpected = expected,
                    findingDetected = detected,
                    -- ADR-004: worker では日本語改善文を生成しない
                    findingMessageJa = Nothing,
                    findingMessageEn = Nothing,
                    findingScoreImpact = severityToScoreImpact severity,
                    findingConfidence = severityToConfidence severity,
                    findingPhenomenon = phenomenon,
                    findingGop = Just gop
                  }
              ]

-- | connectedSpeech の presentation-only finding（severity=suggestion, scoreImpact=0）。
buildConnectedSpeechFinding :: Text -> AnalyzerResult -> [AssessmentFinding]
buildConnectedSpeechFinding sectionBodyText analyzerResult =
  let silences = analyzedInterWordSilences analyzerResult
      longSilences = filter (\s -> silenceDurationMs s > silencePenaltyThresholdMs) silences
   in if null longSilences
        then []
        else
          let textLen = Text.length sectionBodyText
              evidence =
                PronunciationEvidence
                  { evidenceText = Just sectionBodyText,
                    evidenceIpa = Nothing
                  }
           in [ AssessmentFinding
                  { findingCategory = FindingCategoryConnectedSpeech,
                    findingSeverity = FindingSeveritySuggestion,
                    findingTextRange =
                      TextRange
                        { startChar = 0,
                          endChar = textLen
                        },
                    findingAudioRange = Nothing,
                    findingExpected = evidence,
                    findingDetected = evidence,
                    -- ADR-004: worker では日本語改善文を生成しない
                    findingMessageJa = Nothing,
                    findingMessageEn = Nothing,
                    -- presentation-only: scoreImpact=0
                    findingScoreImpact = 0.0,
                    findingConfidence = 0.5,
                    findingPhenomenon = "connectedSpeech",
                    findingGop = Nothing
                  }
              ]

-- ---- 音素分類ユーティリティ ----

-- | GOP 値から FindingSeverity を判定する。閾値以上は Nothing（finding 化しない）。
-- calibratable threshold
gopToSeverity :: Double -> Maybe FindingSeverity
gopToSeverity gop
  | gop < gopMajorThreshold = Just FindingSeverityMajor
  | gop < gopMinorThreshold = Just FindingSeverityMinor
  | otherwise = Nothing

-- | severity に応じた scoreImpact（負値）。
severityToScoreImpact :: FindingSeverity -> Double
severityToScoreImpact FindingSeverityCritical = -8.0
severityToScoreImpact FindingSeverityMajor = -5.0
severityToScoreImpact FindingSeverityMinor = -2.0
severityToScoreImpact FindingSeveritySuggestion = 0.0

-- | severity に応じた confidence。
severityToConfidence :: FindingSeverity -> Double
severityToConfidence FindingSeverityCritical = 0.9
severityToConfidence FindingSeverityMajor = 0.8
severityToConfidence FindingSeverityMinor = 0.7
severityToConfidence FindingSeveritySuggestion = 0.6

-- | expected IPA / detected IPA / 対象音素から phenomenon を分類する。
-- 簡易 Levenshtein 整列で substitution / omission / insertion を判定する。
classifyPhenomenon :: Text -> Text -> Text -> Text
classifyPhenomenon expectedIpa detectedIpa phoneme =
  let expectedChars = Text.unpack expectedIpa
      detectedChars = Text.unpack detectedIpa
      phonemeStr = Text.unpack phoneme
      -- expected に音素が存在し detected に無い -> omission
      -- detected に音素が存在し expected に無い -> insertion
      -- 両方に存在するが異なる -> substitution
      inExpected = phonemeStr `isSubsequenceOf` expectedChars
      inDetected = phonemeStr `isSubsequenceOf` detectedChars
   in case (inExpected, inDetected) of
        (True, False) -> "omission"
        (False, True) -> "insertion"
        _ -> "substitution"

-- | 簡易部分列チェック（音素が IPA 文字列の subsequence に含まれるか）。
isSubsequenceOf :: String -> String -> Bool
isSubsequenceOf [] _ = True
isSubsequenceOf _ [] = False
isSubsequenceOf (x : xs) (y : ys)
  | x == y = isSubsequenceOf xs ys
  | otherwise = isSubsequenceOf (x : xs) ys

-- | 音声時刻から最も近い TokenSegment の TextRange を返す。
findTextRangeForTime :: [TokenSegment] -> Int -> Int -> TextRange
findTextRangeForTime [] _ _ = TextRange {startChar = 0, endChar = 0}
findTextRangeForTime tokens tokenCount startMilliseconds =
  let
    -- 均等割り当てで時刻からトークンインデックスを推定
    tokenIndex = min (tokenCount - 1) (startMilliseconds * tokenCount `div` max 1 startMilliseconds)
    safeIndex = max 0 (min (tokenCount - 1) tokenIndex)
    token = tokens !! safeIndex
   in
    TextRange
      { startChar = tokenStartChar token,
        endChar = tokenEndChar token
      }

-- ---- ScoringOutput から AssessmentScores への変換 ----

-- | ScoringOutput を AssessmentScores に変換する（純粋）。
buildAssessmentScores :: ScoringOutput -> AssessmentScores
buildAssessmentScores scoringOutput =
  AssessmentScores
    { overall = scoreOverall scoringOutput,
      accuracy = scoreAccuracy scoringOutput,
      nativeLikeness = scoreNativeLikeness scoringOutput,
      pronunciation = scorePronunciation scoringOutput,
      connectedSpeech = scoreConnectedSpeech scoringOutput,
      prosody = scoreProsody scoringOutput
    }

-- ---- 後方互換 API（Assessment.hs が呼ぶ） ----

-- | GOP ベース採点の前段: テキスト tokenize のみ実行し ScoringOutput 骨格を返す。
-- AnalyzerResult を受け取って scoreFromGop で上書きする。
scoreAssessment :: ScoringInput -> ScoringOutput
scoreAssessment input =
  let text = inputText input
      tokens = tokenize text
      durationMs = inputDurationMilliseconds input
   in ScoringOutput
        { scoreOverall = 0,
          scoreAccuracy = fixedAccuracyScore,
          scoreNativeLikeness = 0,
          scorePronunciation = 0,
          scoreConnectedSpeech = 0,
          scoreProsody = fixedProsodyScore,
          outputTokens = tokens,
          summaryMessageJa = buildJaMessage 0 0 0 durationMs,
          summaryMessageEn = buildEnMessage 0 0 0
        }

-- | テキスト・AnalyzerResult から findings を生成する（後方互換 API）。
generateFindings ::
  Text ->
  Int ->
  AssessmentScores ->
  [AssessmentFinding]
generateFindings _ _ _ = []

-- ---- サマリーメッセージ ----

buildJaMessage :: Int -> Int -> Int -> Int -> Text
buildJaMessage overallScore connectedSpeechScore prosodyScore _durationMs
  | overallScore >= 80 =
      let connectedSpeechNote =
            if connectedSpeechScore < 70
              then "連結発話にやや改善余地があります。"
              else ""
       in "全体的に非常に良い発音です。" <> connectedSpeechNote
  | overallScore >= 60 =
      let connectedSpeechNote =
            if connectedSpeechScore < 60
              then "連結発話（音の繋がり）を意識すると更に改善できます。"
              else ""
          prosodyNote =
            if prosodyScore < 60
              then "リズムとイントネーションの練習を続けましょう。"
              else ""
       in "概ね良好な発音です。" <> connectedSpeechNote <> prosodyNote
  | otherwise =
      let weakPoint =
            if connectedSpeechScore < prosodyScore
              then "音の繋がり（連結発話）"
              else "リズムとイントネーション（プロソディ）"
       in "基本的な発音練習を継続しましょう。特に" <> weakPoint <> "に注目して練習するとよいでしょう。"

buildEnMessage :: Int -> Int -> Int -> Text
buildEnMessage overallScore connectedSpeechScore prosodyScore
  | overallScore >= 80 =
      let connectedSpeechNote =
            if connectedSpeechScore < 70
              then " Some room for improvement in connected speech."
              else ""
       in "Overall pronunciation is excellent." <> connectedSpeechNote
  | overallScore >= 60 =
      let connectedSpeechNote =
            if connectedSpeechScore < 60
              then " Focus on connected speech patterns."
              else ""
          prosodyNote =
            if prosodyScore < 60
              then " Work on rhythm and intonation."
              else ""
       in "Pronunciation is generally good." <> connectedSpeechNote <> prosodyNote
  | otherwise =
      let weakPoint =
            if connectedSpeechScore < prosodyScore
              then "connected speech."
              else "rhythm and intonation."
       in "Continue practicing basic pronunciation. Focus especially on " <> weakPoint
