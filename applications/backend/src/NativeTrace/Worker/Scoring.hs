-- | 発音解析スコアリング（純粋関数）。
-- GOP（Goodness of Pronunciation）計測値・NBest・F0/韻律を元に採点・finding 生成を行う。
-- 同一入力には必ず同一出力を返す（乱数・IO 不使用）。
module NativeTrace.Worker.Scoring (
  ScoringInput (..),
  ScoringOutput (..),
  TokenSegment (..),
  scoreFromGop,
  generateFindingsFromGop,
  buildAssessmentScores,
  tokenize,
  -- 音質ガード
  isLowQualityAudio,
  audioQualityMinMeanDbfs,
  audioQualityMinRecordingDurationMs,
  audioQualityMinPhonemeDetectionRate,
  audioQualityMaxMedianGop,
  audioQualityMinSnrDb,
  -- 新規 export
  buildPerPhonemeHeatmap,
  buildFocusSounds,
  buildProsodyOutput,
  buildDynamicSummary,
  -- GOP delta 分類 (M-CRL-7 / ADR-022)
  classifyGopDelta,
  -- ADR-018 音響証拠 (M-APD-10/11 テスト用)
  hillenbrandGaVowelFormants,
  deriveAcousticEvidence,
  severityToScoreImpact,
  -- ADR-019 D4 AAI ガードレール
  aaiDisplayEligibilityThreshold,
  articulatoryDisplayGuardrail,
  -- ADR-019 D5 AAI estimate 突合・付与 (W39)
  attachArticulatoryEstimates,
)
where

import Data.Char (isSpace)
import Data.List (find, nub, sort, sortBy)
import Data.Map.Strict (Map)
import Data.Map.Strict qualified as Map
import Data.Maybe (fromMaybe, mapMaybe)
import Data.Ord (Down (..), comparing)
import Data.Text (Text)
import Data.Text qualified as Text
import NativeTrace.Worker.AaiClient (RawArticulatoryEstimate (..))
import NativeTrace.Worker.AnalyzerClient (
  AnalyzerResult (..),
  F0Contour (..),
  InsertedVowelInfo (..),
  InterWordSilence (..),
  NBestEntry (..),
  PhonemeAcoustic (..),
  PhonemeGop (..),
  Rhythm (..),
  SchwaRealization (..),
  SyllableInfo (..),
  WeakFormRealization (..),
  WordStress (..),
 )
import NativeTrace.Worker.AnalyzerClient qualified as AnalyzerClient
import NativeTrace.Worker.Catalog (
  CatalogEntry (..),
  catalog,
  flRank,
  lookupByConfusion,
  lookupByPhoneme,
 )
import NativeTrace.Worker.Types (
  AcousticEvidence (..),
  ArticulatoryEstimate (..),
  AssessmentFinding (..),
  AssessmentScores (..),
  AudioRange (..),
  BoundarySignal (..),
  CefrScore (..),
  DeltaSignal (..),
  FindingCategory (..),
  FindingSeverity (..),
  FocusSound (..),
  GopDeltaResponse (..),
  NBestOutputEntry (..),
  PhonemeHeatEntry (..),
  PronunciationEvidence (..),
  ProsodyOutput (..),
  TextRange (..),
  WordStressOutput (..),
 )

-- ---- ADR-019 D4 AAI ガードレール ----

-- | D4 displayEligibility 閾値（calibratable）。
-- S-AAI-1: キャリブレーション未成熟のため 0.55 を採用。
-- 十分な実録音コーパスで再較正後は 0.7 への引き上げを推奨（one-line edit）。
aaiDisplayEligibilityThreshold :: Double
aaiDisplayEligibilityThreshold = 0.55

-- | AAI ガードレールの最小セグメント長（ミリ秒）。calibratable threshold（W12 で命名）。
aaiMinSegmentMs :: Int
aaiMinSegmentMs = 50

-- | AAI 表示ガードレール（D4-2: Scoring 層が所有）。
-- 以下の条件を全て満たす場合のみ Just ArticulatoryEstimate を返す（満たさなければ Nothing = suppress/floor）:
--   1. displayEligibility >= aaiDisplayEligibilityThreshold (0.55)
--   2. 音素クラスが母音または approximant /r/,/l/ のみ（stop/fricative は抑制）
--   3. セグメント長 (endMs - startMs) >= 50 ms
articulatoryDisplayGuardrail ::
  -- | 音素シンボル（IPA）
  Text ->
  -- | セグメント開始 ms
  Int ->
  -- | セグメント終了 ms
  Int ->
  -- | displayEligibility スコア
  Double ->
  -- | 6 座標 (tongueTipX,tongueTipY,tongueDorsumX,tongueDorsumY,lipApertureX,lipApertureY)
  (Double, Double, Double, Double, Double, Double) ->
  Maybe ArticulatoryEstimate
articulatoryDisplayGuardrail phoneme startMs endMs displayEligibility (ttx, tty, tdx, tdy, lax, lay)
  | displayEligibility < aaiDisplayEligibilityThreshold = Nothing
  | not (isVowelOrApproximant phoneme) = Nothing
  | (endMs - startMs) < aaiMinSegmentMs = Nothing
  | otherwise =
      Just
        ArticulatoryEstimate
          { aeTongueTipX = ttx,
            aeTongueTipY = tty,
            aeTongueDorsumX = tdx,
            aeTongueDorsumY = tdy,
            aeLipApertureX = lax,
            aeLipApertureY = lay,
            aeDisplayEligibility = displayEligibility
          }

-- | 母音・approximant (/r/,/l/) クラス判定。
-- stop (/p/,/b/,/t/,/d/,/k/,/ɡ/) および fricative (/f/,/v/,/θ/,/ð/,/s/,/z/,/ʃ/,/ʒ/,/h/) は False。
-- 母音: IPA シンボルが母音母音文字で始まるか、既知 IPA 文字セットに一致。
isVowelOrApproximant :: Text -> Bool
isVowelOrApproximant phoneme =
  phoneme `elem` vowelsAndApproximants

-- | 許容する音素シンボルセット（母音 + /r/,/l/）。
-- IPA 表記の主要 General American 音素を網羅する。
vowelsAndApproximants :: [Text]
vowelsAndApproximants =
  -- 母音（General American 主要母音）
  [ "iː",
    "ɪ",
    "eɪ",
    "ɛ",
    "æ",
    "ɑ",
    "ɔ",
    "oʊ",
    "ʊ",
    "uː",
    "ʌ",
    "ə",
    "ɚ",
    "aɪ",
    "aʊ",
    "ɔɪ",
    -- 短縮・変形表記
    "i",
    "e",
    "u",
    "o",
    "a",
    -- approximant /r/,/l/ のみ（/w/,/j/ は除外）
    "r",
    "l",
    "ɹ",
    "ɾ"
  ]

-- ---- ADR-019 D5 AAI estimate 突合・付与 (W39) ----

-- | ガードレール（articulatoryDisplayGuardrail）通過 estimate を finding へ突合・付与する。
-- 突合条件は phoneme 一致 または セグメント midpoint の findingAudioRange 含有
-- （Application.hs ハンドラからの字句移動 — 判定式は不変）。
attachArticulatoryEstimates :: [RawArticulatoryEstimate] -> [AssessmentFinding] -> [AssessmentFinding]
attachArticulatoryEstimates rawEstimates findings =
  let passed :: [(Text, Int, Int, ArticulatoryEstimate)]
      passed =
        [ (raePhoneme r, raeStartMs r, raeEndMs r, est)
        | r <- rawEstimates,
          Just est <-
            [ articulatoryDisplayGuardrail
                (raePhoneme r)
                (raeStartMs r)
                (raeEndMs r)
                (raeDisplayEligibility r)
                ( raeTongueTipX r,
                  raeTongueTipY r,
                  raeTongueDorsumX r,
                  raeTongueDorsumY r,
                  raeLipApertureX r,
                  raeLipApertureY r
                )
            ]
        ]
      attachEstimate finding =
        let expectedPhoneme = evidenceIpa (findingExpected finding)
            inAudioRange segmentStartMs segmentEndMs =
              case findingAudioRange finding of
                Just range ->
                  let midpointMs = (segmentStartMs + segmentEndMs) `div` 2
                   in midpointMs >= startMs range && midpointMs <= endMs range
                Nothing -> False
            matched =
              [ est
              | (phoneme, segmentStartMs, segmentEndMs, est) <- passed,
                Just phoneme == expectedPhoneme
                  || inAudioRange segmentStartMs segmentEndMs
              ]
         in case matched of
              (est : _) -> finding {findingArticulatoryEstimate = Just est}
              [] -> finding
   in map attachEstimate findings

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
    scoreIntelligibility :: Int,
    outputTokens :: [TokenSegment]
  }
  deriving (Show, Eq)

-- ---- スコア定数（calibratable threshold） ----

-- | GOP 値を pronunciation スコア（0-100）に線形 clip する下限。
gopFloor :: Double
gopFloor = -20.0

-- | GOP 値を pronunciation スコア（0-100）に線形 clip する上限。
gopCeiling :: Double
gopCeiling = -2.0

-- | finding として検出する GOP 閾値（major）。calibratable threshold
gopMajorThreshold :: Double
gopMajorThreshold = -12.0

-- | finding として検出する GOP 閾値（minor）。calibratable threshold
gopMinorThreshold :: Double
gopMinorThreshold = -8.0

-- | gopToHeat の heat=1 段閾値（calibratable threshold、W12 で命名）。
gopHeatLevel1Threshold :: Double
gopHeatLevel1Threshold = -5.0

-- | connectedSpeech スコアの無音長ペナルティ閾値（ミリ秒）。calibratable threshold
silencePenaltyThresholdMs :: Int
silencePenaltyThresholdMs = 500

-- | connectedSpeech スコアの話速ペナルティ閾値（音素/秒）の上限。calibratable threshold
speechRateUpperThreshold :: Double
speechRateUpperThreshold = 15.0

-- | connectedSpeech スコアの話速ペナルティ閾値（音素/秒）の下限。calibratable threshold
speechRateLowerThreshold :: Double
speechRateLowerThreshold = 3.0

-- | connectedSpeech スコアの基準値。calibratable threshold（W12 で命名）。
connectedSpeechBaseScore :: Int
connectedSpeechBaseScore = 75

-- | connectedSpeech スコアの無音長ペナルティ上限。calibratable threshold（W12 で命名）。
connectedSpeechSilencePenaltyCap :: Int
connectedSpeechSilencePenaltyCap = 20

-- | connectedSpeech スコアの無音 1 件あたりのペナルティ。calibratable threshold（W12 で命名）。
connectedSpeechSilencePenaltyPerOccurrence :: Int
connectedSpeechSilencePenaltyPerOccurrence = 5

-- | connectedSpeech スコアの schwa 未実現率ペナルティのスケール。calibratable threshold（W12 で命名）。
connectedSpeechSchwaPenaltyScale :: Double
connectedSpeechSchwaPenaltyScale = 10.0

-- | connectedSpeech スコアの話速逸脱ペナルティ（固定値）。calibratable threshold（W12 で命名）。
connectedSpeechRatePenalty :: Int
connectedSpeechRatePenalty = 10

-- ---- 音質ガード定数（calibratable threshold） ----

-- | 発話区間フレーム RMS の dBFS 下限。全区間 RMS から発話区間 RMS に変更（ADR-015 D2）。
-- 再較正値: -36.0 dBFS（2026-06-17、実録音コーパス 30 件で speech-active RMS を計測）。
-- 01KTT0W1 クラス（speech_active -24.7 dBFS）が通過し、準無音クリップ（-39.5 dBFS）が棄却される。
audioQualityMinMeanDbfs :: Double
audioQualityMinMeanDbfs = -36.0

audioQualityMinRecordingDurationMs :: Int
audioQualityMinRecordingDurationMs = 1000

audioQualityMinPhonemeDetectionRate :: Double
audioQualityMinPhonemeDetectionRate = 0.25

audioQualityMaxMedianGop :: Double
audioQualityMaxMedianGop = -18.0

-- | SNR 下限（WADA 推定器スケール）。
-- WADA estimator-scale floor (NOT true dB). Rebased per ADR-032 runtime sweep:
-- WADA absolute scale is ~20 dB low/compressed on real speech, so a true-dB (5,10] floor is invalid;
-- 0.5 separates the confident-misdecode regime from valid on the measured ladder.
-- Measured on hello_world.wav: clean=2.13, 20dB=2.05, 10dB=1.27, 5dB=-0.15, 0dB=-2.74 (estimator units).
-- 0.5 gates the confident-misdecode regime (true-SNR ≤5 dB reads ≤ -0.15) while passing valid
-- (true-SNR ≥10 dB reads ≥ 1.27); 0.5 sits between with margin.
--
-- DISABLED 2026-06-20: ADR-032 D4補正-2
-- 13-clip validation proved the fixed WADA floor is not clip-portable (false-rejects 6/13 clean clips).
-- The SNR gate does NOT fire pending the ADR-032 redesign (per-clip-relative drop gate).
-- estimatedSnrDb measurement plumbing (analyzer + AnalyzerClient decode) is retained for that redesign.
-- Exported to prevent unused-binding error; referenced by self-eval harness and tests documentation.
audioQualityMinSnrDb :: Double
audioQualityMinSnrDb = 0.5

-- | 音声品質チェック。低品質なら True を返す。
isLowQualityAudio ::
  Double -> Int -> Int -> Int -> [Double] -> Double -> Bool
isLowQualityAudio meanDbfs durationMilliseconds detectedPhonemeCount expectedPhonemeCount gopValues _estimatedSnrDb =
  -- NOTE: SNR gate DISABLED 2026-06-20 (ADR-032 D4補正-2) — 13-clip validation proved the fixed
  -- WADA floor is not clip-portable (false-rejects 6/13 clean clips). The || estimatedSnrDb <
  -- audioQualityMinSnrDb clause has been removed. estimatedSnrDb plumbing is retained for the
  -- per-clip-relative redesign.
  meanDbfs < audioQualityMinMeanDbfs
    || durationMilliseconds < audioQualityMinRecordingDurationMs
    || isLowPhonemeDetectionRate detectedPhonemeCount expectedPhonemeCount
    || isLowMedianGop gopValues

isLowPhonemeDetectionRate :: Int -> Int -> Bool
isLowPhonemeDetectionRate detectedCount expectedCount
  | expectedCount <= 0 = False
  | detectedCount <= 0 = True
  | otherwise =
      fromIntegral detectedCount / fromIntegral expectedCount
        < audioQualityMinPhonemeDetectionRate

isLowMedianGop :: [Double] -> Bool
isLowMedianGop [] = True
isLowMedianGop gopValues = medianGop gopValues < audioQualityMaxMedianGop

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

clampScore :: Int -> Int
clampScore n
  | n < 0 = 0
  | n > 100 = 100
  | otherwise = n

gopAverageToScore :: [Double] -> Int
gopAverageToScore [] = 50
gopAverageToScore gops =
  let avg = sum gops / fromIntegral (length gops)
      normalized = (avg - gopFloor) / (gopCeiling - gopFloor)
   in clampScore (round (normalized * 100.0))

-- | connectedSpeech スコアを無音長・schwa 実現率・話速から算出する。
connectedSpeechScore :: [InterWordSilence] -> [SchwaRealization] -> Double -> Int
connectedSpeechScore silences schwaRealizations speechRate =
  let base = connectedSpeechBaseScore
      longSilenceCount =
        length $
          filter
            (\s -> silenceDurationMs s > silencePenaltyThresholdMs)
            silences
      silencePenalty = min connectedSpeechSilencePenaltyCap (longSilenceCount * connectedSpeechSilencePenaltyPerOccurrence)
      schwaTotal = length schwaRealizations
      schwaRealizedCount = length (filter schwaRealized schwaRealizations)
      schwaPenalty =
        if schwaTotal == 0
          then 0
          else
            let unrealizedRate = fromIntegral (schwaTotal - schwaRealizedCount) / fromIntegral schwaTotal :: Double
             in round (unrealizedRate * connectedSpeechSchwaPenaltyScale) :: Int
      ratePenalty =
        if speechRate < speechRateLowerThreshold || speechRate > speechRateUpperThreshold
          then connectedSpeechRatePenalty
          else 0
   in clampScore (base - silencePenalty - schwaPenalty - ratePenalty)

-- ---- accuracy スコア（NBest/GOP 由来、M-111） ----

-- | accuracy スコアを GOP 値と NBest から算出する。
-- GOP 平均から基本スコアを得た後、NBest 最有力候補が期待音素と一致しているかで補正する。
computeAccuracyScore :: [PhonemeGop] -> Int
computeAccuracyScore [] = 50
computeAccuracyScore phonemeGops =
  let gopValues = map gopValue phonemeGops
      baseScore = gopAverageToScore gopValues
      -- NBest 最有力候補が期待音素と一致する音素の割合でボーナス付与
      nBestBonus = computeNBestAccuracyBonus phonemeGops
   in clampScore (baseScore + nBestBonus)

-- | NBest 整合ボーナスの一致率中点。calibratable threshold（W12 で命名）。
nBestAccuracyBonusMidpoint :: Double
nBestAccuracyBonusMidpoint = 0.5

-- | NBest 整合ボーナスのスケール。calibratable threshold（W12 で命名）。
nBestAccuracyBonusScale :: Double
nBestAccuracyBonusScale = 10.0

-- | NBest 整合ボーナス計算（-5〜+5）。
computeNBestAccuracyBonus :: [PhonemeGop] -> Int
computeNBestAccuracyBonus phonemeGops =
  let phonemesWithNBest = filter (not . null . gopNBest) phonemeGops
   in if null phonemesWithNBest
        then 0
        else
          let matchCount =
                length $
                  filter
                    ( \pg ->
                        case gopNBest pg of
                          (top : _) -> nBestPhoneme top == gopPhoneme pg
                          [] -> False
                    )
                    phonemesWithNBest
              matchRate = fromIntegral matchCount / fromIntegral (length phonemesWithNBest) :: Double
           in round ((matchRate - nBestAccuracyBonusMidpoint) * nBestAccuracyBonusScale) :: Int

-- ---- prosody スコア（stress + nPVI + 弱形実現率、M-114） ----

-- | prosody スコアの基準値。calibratable threshold（W12 で命名）。
prosodyBaseScore :: Int
prosodyBaseScore = 65

-- | 語強勢誤り率ペナルティのスケール。calibratable threshold（W12 で命名）。
stressPenaltyScale :: Double
stressPenaltyScale = 20.0

-- | nPVI 偏差ペナルティの除数。calibratable threshold（W12 で命名）。
npviPenaltyDivisor :: Double
npviPenaltyDivisor = 5.0

-- | nPVI 偏差ペナルティの上限。calibratable threshold（W12 で命名）。
npviPenaltyCap :: Int
npviPenaltyCap = 15

-- | 弱形未実現率ペナルティのスケール。calibratable threshold（W12 で命名）。
weakFormPenaltyScale :: Double
weakFormPenaltyScale = 10.0

-- | prosody スコアを語強勢精度・nPVI 近接度・弱形実現率から算出する。
computeProsodyScore :: [WordStress] -> Maybe Rhythm -> [WeakFormRealization] -> Int
computeProsodyScore wordStresses maybeRhythm weakFormRealizations =
  let base = prosodyBaseScore
      -- 語強勢精度ペナルティ
      stressPenalty = computeStressPenalty wordStresses
      -- nPVI 近接ペナルティ
      npviPenalty = computeNpviPenalty maybeRhythm
      -- 弱形実現率ペナルティ
      weakFormPenalty = computeWeakFormPenalty weakFormRealizations
   in clampScore (base - stressPenalty - npviPenalty - weakFormPenalty)

computeStressPenalty :: [WordStress] -> Int
computeStressPenalty [] = 0
computeStressPenalty wordStresses =
  let errorCount = length $ filter (\ws -> wordStressExpected ws /= wordStressPredicted ws) wordStresses
      total = length wordStresses
      errorRate = fromIntegral errorCount / fromIntegral total :: Double
   in round (errorRate * stressPenaltyScale) :: Int

computeNpviPenalty :: Maybe Rhythm -> Int
computeNpviPenalty Nothing = 0
computeNpviPenalty (Just rhythm) =
  let npvi = rhythmNpviVocalic rhythm
      refNpvi = rhythmReferenceNpviVocalic rhythm
      deviation = abs (npvi - refNpvi)
   in min npviPenaltyCap (round (deviation / npviPenaltyDivisor) :: Int)

computeWeakFormPenalty :: [WeakFormRealization] -> Int
computeWeakFormPenalty [] = 0
computeWeakFormPenalty weakForms =
  let expectedWeakForms = filter weakFormExpectedWeak weakForms
   in if null expectedWeakForms
        then 0
        else
          let unrealizedCount = length $ filter (not . weakFormRealizedWeak) expectedWeakForms
              unrealizedRate = fromIntegral unrealizedCount / fromIntegral (length expectedWeakForms) :: Double
           in round (unrealizedRate * weakFormPenaltyScale) :: Int

-- ---- FL 重み付き intelligibility スコア（M-111） ----

-- | FL 重み付き intelligibility スコアを算出する。
-- 高FL誤りは加算的に減点、低FLは件数増で逓減（sqrt 飽和）。
computeIntelligibilityScore :: [AssessmentFinding] -> Int
computeIntelligibilityScore [] = 100
computeIntelligibilityScore findings =
  let base = 100.0 :: Double
      totalPenalty = sum (map computeFindingPenalty findings)
   in clampScore (round (base - totalPenalty))

-- | finding 1件あたりのペナルティ（FL ランク × severity 重み）。
-- 高FL は線形減点、低FL は sqrt 飽和を模擬するため除数でスケールダウン。
-- W12: 以下の FL 係数・severity 係数は live パス（このファイル）唯一の正であり、
-- Catalog 側の重みと意図的に統一しない（ADR 判断待ち）。数値は変更禁止。
computeFindingPenalty :: AssessmentFinding -> Double
computeFindingPenalty finding =
  let flMultiplier = case findingFunctionalLoad finding of
        Just "max" -> 4.0
        Just "high" -> 3.0
        Just "mid" -> 1.5
        Just "low" -> 0.8
        _ -> 1.0
      severityMultiplier = case findingSeverity finding of
        FindingSeverityCritical -> 2.0
        FindingSeverityMajor -> 1.5
        FindingSeverityMinor -> 1.0
        FindingSeveritySuggestion -> 0.2
   in flMultiplier * severityMultiplier

-- ---- CEFR バンド変換（M-111） ----

-- | CEFR バンド境界（calibratable threshold、W12 で命名）。
cefrThresholdC1 :: Int
cefrThresholdC1 = 80

cefrThresholdB2 :: Int
cefrThresholdB2 = 70

cefrThresholdB1Plus :: Int
cefrThresholdB1Plus = 55

cefrThresholdB1 :: Int
cefrThresholdB1 = 40

scoreToCefrBand :: Int -> Text
scoreToCefrBand score
  | score >= cefrThresholdC1 = "C1"
  | score >= cefrThresholdB2 = "B2"
  | score >= cefrThresholdB1Plus = "B1+"
  | score >= cefrThresholdB1 = "B1"
  | otherwise = "A2"

buildCefrScore :: Int -> CefrScore
buildCefrScore score = CefrScore {cefrScoreValue = score, cefrBand = scoreToCefrBand score}

-- ---- GOP ベースのスコアリング ----

-- | nativeLikeness ブレンドの pronunciation 側重み。calibratable threshold（W12 で命名）。
nativeLikenessPronunciationWeight :: Int
nativeLikenessPronunciationWeight = 60

-- | nativeLikeness ブレンドの connectedSpeech 側重み。calibratable threshold（W12 で命名）。
nativeLikenessConnectedSpeechWeight :: Int
nativeLikenessConnectedSpeechWeight = 40

-- | overall 加重集約の pronunciation 重み。calibratable threshold（W12 で命名）。
overallPronunciationWeight :: Int
overallPronunciationWeight = 30

-- | overall 加重集約の accuracy 重み。calibratable threshold（W12 で命名）。
overallAccuracyWeight :: Int
overallAccuracyWeight = 20

-- | overall 加重集約の connectedSpeech 重み。calibratable threshold（W12 で命名）。
overallConnectedSpeechWeight :: Int
overallConnectedSpeechWeight = 20

-- | overall 加重集約の prosody 重み。calibratable threshold（W12 で命名）。
overallProsodyWeight :: Int
overallProsodyWeight = 15

-- | overall 加重集約の nativeLikeness 重み。calibratable threshold（W12 で命名）。
overallNativeLikenessWeight :: Int
overallNativeLikenessWeight = 15

scoreFromGop :: AnalyzerResult -> [TokenSegment] -> ScoringOutput
scoreFromGop result tokens =
  let phonemeGops = analyzedPerPhonemeGop result
      gops = map gopValue phonemeGops
      pronunciationScore = gopAverageToScore gops
      connectedSpeechScoreValue =
        connectedSpeechScore
          (analyzedInterWordSilences result)
          (analyzedSchwaRealizations result)
          (analyzedSpeechRatePhonemePerSecond result)
      -- accuracy: GOP/NBest 由来（固定値廃止、M-111）
      accuracyScore = computeAccuracyScore phonemeGops
      -- prosody: stress + nPVI + 弱形実現率由来（固定値廃止、M-114）
      prosodyScore = computeProsodyScore (analyzedWordStress result) (analyzedRhythm result) (analyzedWeakFormRealizations result)
      -- nativeLikeness: pronunciation と connectedSpeech のブレンド
      nativeLikenessScore =
        clampScore $
          ( pronunciationScore * nativeLikenessPronunciationWeight
              + connectedSpeechScoreValue * nativeLikenessConnectedSpeechWeight
          )
            `div` 100
      -- overall: 加重集約
      overallScore =
        clampScore $
          ( pronunciationScore * overallPronunciationWeight
              + accuracyScore * overallAccuracyWeight
              + connectedSpeechScoreValue * overallConnectedSpeechWeight
              + prosodyScore * overallProsodyWeight
              + nativeLikenessScore * overallNativeLikenessWeight
          )
            `div` 100
      -- intelligibility はまず findings なしで算出（後で findings から上書き可）
      intelligibilityScore = clampScore overallScore
   in ScoringOutput
        { scoreOverall = overallScore,
          scoreAccuracy = accuracyScore,
          scoreNativeLikeness = nativeLikenessScore,
          scorePronunciation = pronunciationScore,
          scoreConnectedSpeech = connectedSpeechScoreValue,
          scoreProsody = prosodyScore,
          scoreIntelligibility = intelligibilityScore,
          outputTokens = tokens
        }

-- ---- Finding 生成 ----

-- | AnalyzerResult から AssessmentFinding リストを生成する（純粋・決定的）。
generateFindingsFromGop ::
  Text ->
  AnalyzerResult ->
  [AssessmentFinding]
generateFindingsFromGop sectionBodyText analyzerResult =
  let tokens = tokenize sectionBodyText
      tokenCount = length tokens
      allPhonemeGops = analyzedPerPhonemeGop analyzerResult
      expectedIpa = analyzedExpectedIpa analyzerResult
      detectedIpa = analyzedDetectedIpa analyzerResult
      gopFindings =
        concatMap
          ( buildGopFinding
              tokenCount
              tokens
              expectedIpa
              detectedIpa
              (analyzedPhonemeAcoustics analyzerResult)
              (analyzedSpeakerSex analyzerResult)
          )
          allPhonemeGops
      -- epenthesis findings（M-115）
      epenthesisFindings = buildEpenthesisFindings sectionBodyText (analyzedSyllables analyzerResult) tokenCount tokens
      -- lexicalStress findings（M-102）
      stressFindings = buildLexicalStressFindings sectionBodyText (analyzedWordStress analyzerResult) tokenCount tokens
      -- weakForm findings（M-102/M-114）
      weakFormFindings = buildWeakFormFindings sectionBodyText (analyzedWeakFormRealizations analyzerResult) tokenCount tokens
      -- connected speech 4 現象 findings（M-102R）
      linkingFindings = buildLinkingFindings (analyzedInterWordSilences analyzerResult) allPhonemeGops tokens tokenCount
      flapFindings = buildFlapFindings allPhonemeGops tokens tokenCount
      assimilationFindings = buildAssimilationFindings allPhonemeGops tokens tokenCount
      reductionFindings = buildReductionFindings (analyzedSchwaRealizations analyzerResult) (analyzedWeakFormRealizations analyzerResult) allPhonemeGops tokens tokenCount
   in gopFindings
        <> epenthesisFindings
        <> stressFindings
        <> weakFormFindings
        <> linkingFindings
        <> flapFindings
        <> assimilationFindings
        <> reductionFindings

-- | NBest 上位 3 件を NBestOutputEntry へ整形する（W12: 3 箇所重複のヘルパー抽出、値は不変）。
-- 空リストのときは Nothing、非空のときは先頭 3 件を変換して Just（既存 3 箇所と完全同値）。
toNBestOutput :: [NBestEntry] -> Maybe [NBestOutputEntry]
toNBestOutput [] = Nothing
toNBestOutput entries = Just (map toEntry (take 3 entries))
 where
  toEntry e = NBestOutputEntry {nBestOutputPhoneme = nBestPhoneme e, nBestOutputConfidence = nBestConfidence e}

-- | カタログエントリから (catalogId, functionalLoadRank) を取り出す
-- （W12: 3+1 箇所重複のヘルパー抽出、値は不変）。
catalogRef :: Maybe CatalogEntry -> (Maybe Text, Maybe Text)
catalogRef (Just e) = (Just (catalogIdentifier e), Just (flRank (catalogFunctionalLoad e)))
catalogRef Nothing = (Nothing, Nothing)

-- | GOP finding のカタログ照合（confusion 優先・phoneme 単独照合へフォールバック）を解決する
-- （W12: buildGopFinding 内の case 梯子を抽出、値は不変）。
resolveCatalogMatch :: Text -> Maybe Text -> (Bool, Maybe Text, Maybe Text)
resolveCatalogMatch phoneme topCandidate =
  let catalogMatch = do
        detectedPhoneme <- topCandidate
        lookupByConfusion phoneme detectedPhoneme
   in case catalogMatch of
        Just entry ->
          let (catalogId, flText) = catalogRef (Just entry)
           in (True, catalogId, flText)
        Nothing ->
          let (catalogId, flText) = catalogRef (lookupByPhoneme phoneme)
           in (False, catalogId, flText)

buildGopFinding ::
  Int ->
  [TokenSegment] ->
  Text ->
  Text ->
  [PhonemeAcoustic] ->
  Text ->
  PhonemeGop ->
  [AssessmentFinding]
buildGopFinding tokenCount tokens expectedIpa detectedIpa phonemeAcoustics speakerSex phonemeGop =
  let gop = gopValue phonemeGop
   in case gopToSeverity gop of
        Nothing -> []
        Just severity ->
          let phoneme = gopPhoneme phonemeGop
              startMilliseconds = gopStartMs phonemeGop
              endMilliseconds = gopEndMs phonemeGop
              acousticEvidence =
                (\m -> deriveAcousticEvidence phoneme m speakerSex phonemeAcoustics)
                  <$> matchPhonemeAcoustic phoneme startMilliseconds endMilliseconds phonemeAcoustics
              textRange = findTextRangeForTime tokens tokenCount startMilliseconds
              phenomenon = classifyPhenomenon expectedIpa detectedIpa phoneme
              -- NBest 照合（M-103）
              nBestEntries = gopNBest phonemeGop
              topCandidate = case nBestEntries of
                (top : _) -> Just (nBestPhoneme top)
                [] -> Nothing
              nBestOutput = toNBestOutput nBestEntries
              -- カタログ照合（M-101/M-103）
              (matchesL1, catalogId, functionalLoadText) = resolveCatalogMatch phoneme topCandidate
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
                    findingMessageJa = Nothing,
                    findingMessageEn = Nothing,
                    findingScoreImpact = severityToScoreImpact severity,
                    findingConfidence = severityToConfidence severity,
                    findingPhenomenon = phenomenon,
                    findingGop = Just gop,
                    findingDetectedTopCandidate = topCandidate,
                    findingNBest = nBestOutput,
                    findingMatchesL1Pattern = matchesL1,
                    findingFunctionalLoad = functionalLoadText,
                    findingCatalogId = catalogId,
                    findingWordPair = Nothing,
                    findingExpectedPronunciation = Nothing,
                    findingInsertedVowel = Nothing,
                    findingInsertionPositionMs = Nothing,
                    findingWordPositionLabel = gopWordPosition phonemeGop,
                    findingAcousticEvidence = acousticEvidence,
                    findingArticulatoryEstimate = Nothing
                  }
              ]

-- ADR-018 D4: Hillenbrand et al. (1995) JASA 97(5):3099-3111 — General American
-- 母音フォルマント平均 (Hz)。key = (IPA, sex) で sex は "F" | "M"。analyzer は生 Hz のみ返すため、
-- 偏差判定の目標ノルムは scoring を所有する worker (ADR-004) が保持する。
hillenbrandGaVowelFormants :: Map (Text, Text) (Double, Double, Double)
hillenbrandGaVowelFormants =
  Map.fromList
    [ (("iː", "M"), (270, 2290, 3010)),
      (("ɪ", "M"), (430, 2070, 2950)),
      (("æ", "M"), (660, 1720, 2600)),
      (("ɑ", "M"), (730, 1090, 2440)),
      (("uː", "M"), (300, 870, 2240)),
      (("iː", "F"), (437, 2761, 3372)),
      (("ɪ", "F"), (483, 2365, 3053)),
      (("æ", "F"), (669, 2349, 2972)),
      (("ɑ", "F"), (936, 1551, 2815)),
      (("uː", "F"), (459, 1105, 2735))
    ]

-- ADR-018 D5: articulatory-direction 判定の calibratable 定数 (GOP しきい値と同じ policy locus)。
acousticF1SdThreshold :: Double
acousticF1SdThreshold = 1.0

acousticF2SdThreshold :: Double
acousticF2SdThreshold = 1.0

-- M-APD-11: M/F パスで発話内 SD が計算不能 (<2 母音) なとき normHz に対して仮定する相対 SD。
-- Hillenbrand (1995) の F1 話者間 SD/平均 比は概ね 10-15% の範囲。偽陽性を抑えるため保守寄りの 10% を採用。
-- ここを大きくするとラベルが立ちにくくなり、小さくすると立ちやすくなる（calibratable）。
acousticFallbackRelativeSd :: Double
acousticFallbackRelativeSd = 0.10

rhoticF3MaleHz :: Double
rhoticF3MaleHz = 2000

rhoticF3FemaleHz :: Double
rhoticF3FemaleHz = 2300

lateralF3OverretroflexHz :: Double
lateralF3OverretroflexHz = 2500

sibilantSCentroidHz :: Double
sibilantSCentroidHz = 4500

sibilantShCentroidHz :: Double
sibilantShCentroidHz = 3500

tenseLaxDurationRatio :: Double
tenseLaxDurationRatio = 1.4

-- vowelLength 判定対象の tense (長) 母音。
tenseVowelPhonemes :: [Text]
tenseVowelPhonemes = ["iː", "uː"]

-- vowelLength の発話内 baseline に使う lax (短) 母音。
laxVowelPhonemes :: [Text]
laxVowelPhonemes = ["ɪ", "ʊ", "ə", "ɛ", "ʌ", "æ", "ɒ"]

acousticMean :: [Double] -> Double
acousticMean [] = 0
acousticMean xs = sum xs / fromIntegral (length xs)

acousticStdDev :: [Double] -> Double
acousticStdDev xs
  | length xs < 2 = 0
  | otherwise =
      let m = acousticMean xs
       in sqrt (sum [(x - m) * (x - m) | x <- xs] / fromIntegral (length xs))

-- 偏差 (in-utterance SD 単位) から方向ラベルを返す。
deviationLabel :: Double -> Double -> Double -> Double -> Text -> Text -> Maybe Text
deviationLabel value target sd threshold posLabel negLabel
  | sd <= 0 = Nothing
  | d > threshold = Just posLabel
  | d < negate threshold = Just negLabel
  | otherwise = Just "ok"
 where
  d = (value - target) / sd

-- | 当該音素 (IPA + 時間境界) に対応する PhonemeAcoustic を突き合わせる。
-- 同一 IPA が複数あるときは境界中点が最も近いものを選ぶ。
matchPhonemeAcoustic :: Text -> Int -> Int -> [PhonemeAcoustic] -> Maybe PhonemeAcoustic
matchPhonemeAcoustic phoneme startMilliseconds endMilliseconds acoustics =
  case filter ((== phoneme) . acousticPhoneme) acoustics of
    [] -> Nothing
    (c : cs) -> Just (foldr closer c cs)
 where
  target = fromIntegral (startMilliseconds + endMilliseconds) / 2 :: Double
  mid a = fromIntegral (acousticStartMs a + acousticEndMs a) / 2 :: Double
  closer a b = if abs (mid a - target) < abs (mid b - target) then a else b

-- | ADR-018 D5: 計測値と Hillenbrand ノルムの偏差から articulatory-direction ラベルを導出する。
-- analyzer は生 Hz のみ返す。しきい値判定 (scoring policy, ADR-004) は worker が所有する。
-- scoreImpact には一切影響しない (D7、二重減点回避)。speakerSex 'unknown' は発話内正規化に倒す。
--
-- S-APD-5: runtime では speakerSex は常に 'unknown'（UI 収集は Non-goal、かつ
-- FE request-mapper と worker AnalyzerMetadata の 2 層で未配線）→ M/F 分岐
-- （tongueHeight/tongueBackness の | otherwise = ... 節）は runtime 到達不能・unit のみ被覆。
deriveAcousticEvidence :: Text -> PhonemeAcoustic -> Text -> [PhonemeAcoustic] -> AcousticEvidence
deriveAcousticEvidence phoneme measured sex allAcoustics =
  AcousticEvidence
    { acousticTongueHeight = tongueHeight,
      acousticTongueBackness = tongueBackness,
      acousticRhoticity = rhoticity,
      acousticSibilantPlace = sibilantPlace,
      acousticVowelLength = vowelLength,
      acousticMeasuredF1Hz = acousticF1Hz measured,
      acousticMeasuredF2Hz = acousticF2Hz measured,
      acousticMeasuredF3Hz = acousticF3Hz measured,
      acousticTargetF1Hz = targetF1,
      acousticTargetF2Hz = targetF2,
      acousticTargetF3Hz = targetF3,
      -- ADR-024 M-ADVL-11: presentation-only scalars
      acousticSpectralCentroidHz = AnalyzerClient.acousticSpectralCentroidHz measured,
      acousticTenseLengthRatio = tenseLengthRatio,
      acousticSignedF1SdDeviation = signedF1SdDeviation,
      acousticSignedF2SdDeviation = signedF2SdDeviation,
      acousticSignedF3SdDeviation = signedF3SdDeviation,
      acousticTargetSpectralCentroidHz = targetSpectralCentroidHz,
      acousticTargetTenseLengthRatio = targetTenseLengthRatio
    }
 where
  isVowel = phoneme `elem` fullVowelPhonemes
  normSex = if sex == "F" then "F" else "M"
  normRow = Map.lookup (phoneme, normSex) hillenbrandGaVowelFormants
  (targetF1, targetF2, targetF3) = case normRow of
    Just (a, b, c) -> (Just a, Just b, Just c)
    Nothing -> (Nothing, Nothing, Nothing)

  -- 発話内母音 (F1 が非 None) を Lobanov 正規化の母集団に使う。
  -- speakerSex='unknown' のとき発話内 SD で正規化する (Lobanov)。3 母音未満は正規化不能 → guard で弾く。
  -- speakerSex='M'/'F' のとき hillenbrand ノルム行を直接参照するため発話内 SD は補助的な用途のみ。
  utteranceVowels =
    [ a
    | a <- allAcoustics,
      acousticPhoneme a `elem` fullVowelPhonemes,
      Just _ <- [acousticF1Hz a]
    ]
  vowelF1s = [f1 | a <- utteranceVowels, Just f1 <- [acousticF1Hz a]]
  vowelF2s = [f2 | a <- utteranceVowels, Just f2 <- [acousticF2Hz a]]
  vowelF3s = [f3 | a <- utteranceVowels, Just f3 <- [acousticF3Hz a]]
  -- enoughVowels ガードは speakerSex='unknown' の Lobanov パスのみに適用する (M-APD-11)。
  -- M/F パスはノルム行を直接参照するため母音数に依存しない。
  enoughVowelsForLobanov = length utteranceVowels >= 3
  sdF1 = acousticStdDev vowelF1s
  sdF2 = acousticStdDev vowelF2s
  sdF3 = acousticStdDev vowelF3s

  -- ADR-024 M-ADVL-11: signed SD deviations (presentation-only, scoreImpact 不変)
  -- effectiveSdF1/effectiveSdF2 は tongueHeight/tongueBackness の M/F パスと同一算出式。
  -- speakerSex='unknown' の Lobanov パスでは sdF1/sdF2 をそのまま使い、
  -- ゼロ SD のとき Nothing を返す（deviationLabel と同一挙動）。
  signedF1SdDeviation
    | not isVowel = Nothing
    | sex == "unknown" =
        if not enoughVowelsForLobanov
          then Nothing
          else case (acousticF1Hz measured, normRow) of
            (Just f1, Just (nF1, _, _)) ->
              if sdF1 <= 0 then Nothing else Just ((f1 - nF1) / sdF1)
            _ -> Nothing
    | otherwise = case (acousticF1Hz measured, normRow) of
        (Just f1, Just (nF1, _, _)) ->
          let effectiveSdF1 = if sdF1 > 0 then sdF1 else nF1 * acousticFallbackRelativeSd
           in Just ((f1 - nF1) / effectiveSdF1)
        _ -> Nothing

  signedF2SdDeviation
    | not isVowel = Nothing
    | sex == "unknown" =
        if not enoughVowelsForLobanov
          then Nothing
          else case (acousticF2Hz measured, normRow) of
            (Just f2, Just (_, nF2, _)) ->
              if sdF2 <= 0 then Nothing else Just ((f2 - nF2) / sdF2)
            _ -> Nothing
    | otherwise = case (acousticF2Hz measured, normRow) of
        (Just f2, Just (_, nF2, _)) ->
          let effectiveSdF2 = if sdF2 > 0 then sdF2 else nF2 * acousticFallbackRelativeSd
           in Just ((f2 - nF2) / effectiveSdF2)
        _ -> Nothing

  signedF3SdDeviation
    | not isVowel = Nothing
    | otherwise = case (acousticF3Hz measured, normRow) of
        (Just f3, Just (_, _, nF3)) ->
          let effectiveSdF3 = if sdF3 > 0 then sdF3 else nF3 * acousticFallbackRelativeSd
           in Just ((f3 - nF3) / effectiveSdF3)
        _ -> Nothing

  -- lax duration 計測値（W12: tenseLengthRatio / vowelLength 共有 binding、値は不変）。
  laxDurations = [fromIntegral (acousticDurationMs a) | a <- allAcoustics, acousticPhoneme a `elem` laxVowelPhonemes]
  measuredDur = fromIntegral (acousticDurationMs measured) :: Double

  -- tenseLengthRatio: tense 音素のとき measuredDurMs / mean(lax durations)。lax 不在は Nothing。
  tenseLengthRatio
    | phoneme `elem` tenseVowelPhonemes =
        if null laxDurations
          then Nothing
          else Just (measuredDur / acousticMean laxDurations)
    | otherwise = Nothing

  -- targetSpectralCentroidHz: /s/ → 4500, /ʃ/ → 3500, それ以外 → Nothing。
  targetSpectralCentroidHz
    | phoneme == "s" = Just sibilantSCentroidHz
    | phoneme == "ʃ" = Just sibilantShCentroidHz
    | otherwise = Nothing

  -- targetTenseLengthRatio: tense 音素 → 1.4, それ以外 → Nothing。
  targetTenseLengthRatio
    | phoneme `elem` tenseVowelPhonemes = Just tenseLaxDurationRatio
    | otherwise = Nothing

  -- tongueHeight: 高 F1 = 開口 = 舌が低い。
  -- speakerSex='unknown': Lobanov 正規化。3 母音未満は正規化不能 → Nothing (偽陽性回避)。
  -- speakerSex='M'/'F': sex キーのノルム行を直接参照。発話内 SD が計算可能 (>=2) なら使い、
  --   不能なら acousticFallbackRelativeSd × normF1 を SD 代替値とする (calibratable)。
  --   ※ 発話内母音の F1 がほぼ同一のとき SD→0 になる (blowup) ため deviationLabel が Nothing を返す。
  --     その場合は偽陰性方向に倒れる。acousticF1SdThreshold を下げると感度が上がる (calibratable)。
  tongueHeight
    | not isVowel = Nothing
    | sex == "unknown" =
        if not enoughVowelsForLobanov
          then Nothing
          else case (acousticF1Hz measured, normRow) of
            (Just f1, Just (nF1, _, _)) -> deviationLabel f1 nF1 sdF1 acousticF1SdThreshold "tooLow" "tooHigh"
            _ -> Nothing
    | otherwise = case (acousticF1Hz measured, normRow) of
        (Just f1, Just (nF1, _, _)) ->
          let effectiveSdF1 = if sdF1 > 0 then sdF1 else nF1 * acousticFallbackRelativeSd
           in deviationLabel f1 nF1 effectiveSdF1 acousticF1SdThreshold "tooLow" "tooHigh"
        _ -> Nothing

  -- tongueBackness: 高 F2 = 舌が前。
  -- speakerSex='unknown': Lobanov 正規化。3 母音未満は正規化不能 → Nothing (偽陽性回避)。
  -- speakerSex='M'/'F': sex キーのノルム行を直接参照。SD フォールバックは tongueHeight と同方針。
  tongueBackness
    | not isVowel = Nothing
    | sex == "unknown" =
        if not enoughVowelsForLobanov
          then Nothing
          else case (acousticF2Hz measured, normRow) of
            (Just f2, Just (_, nF2, _)) -> deviationLabel f2 nF2 sdF2 acousticF2SdThreshold "tooFront" "tooBack"
            _ -> Nothing
    | otherwise = case (acousticF2Hz measured, normRow) of
        (Just f2, Just (_, nF2, _)) ->
          let effectiveSdF2 = if sdF2 > 0 then sdF2 else nF2 * acousticFallbackRelativeSd
           in deviationLabel f2 nF2 effectiveSdF2 acousticF2SdThreshold "tooFront" "tooBack"
        _ -> Nothing

  -- rhoticity: /r/ は F3 が高いと r 音性不足、/l/ は F3 が低すぎると過剰そり舌。期待音素で一意。
  rhoticity
    | phoneme == "r" || phoneme == "ɹ" = case acousticF3Hz measured of
        Just f3 -> Just (if f3 >= rhoticThreshold then "insufficient" else "ok")
        Nothing -> Nothing
    | phoneme == "l" = case acousticF3Hz measured of
        Just f3 -> Just (if f3 < lateralF3OverretroflexHz then "overRetroflex" else "ok")
        Nothing -> Nothing
    | otherwise = Nothing
   where
    rhoticThreshold = if sex == "F" then rhoticF3FemaleHz else rhoticF3MaleHz

  -- sibilantPlace: /s/ は重心が低いと口蓋化、/ʃ/ は重心が高いと歯茎化。
  sibilantPlace
    | phoneme == "s" = case AnalyzerClient.acousticSpectralCentroidHz measured of
        Just c -> Just (if c < sibilantShCentroidHz then "tooPalatal" else "ok")
        Nothing -> Nothing
    | phoneme == "ʃ" = case AnalyzerClient.acousticSpectralCentroidHz measured of
        Just c -> Just (if c > sibilantSCentroidHz then "tooAlveolar" else "ok")
        Nothing -> Nothing
    | otherwise = Nothing

  -- vowelLength: tense 母音が発話内 lax 母音平均長 ×1.4 未満なら短すぎ (ratio-based)。
  vowelLength
    | phoneme `elem` tenseVowelPhonemes =
        if null laxDurations
          then Just "ok"
          else Just (if measuredDur < acousticMean laxDurations * tenseLaxDurationRatio then "tooShort" else "ok")
    | otherwise = Nothing

-- | epenthesis finding の confidence（固定値、W12 で命名）。
epenthesisFindingConfidence :: Double
epenthesisFindingConfidence = 0.75

-- | epenthesis finding を音節情報から生成する（M-115）。
buildEpenthesisFindings ::
  Text ->
  [SyllableInfo] ->
  Int ->
  [TokenSegment] ->
  [AssessmentFinding]
buildEpenthesisFindings _sectionBodyText syllables tokenCount tokens =
  concatMap buildOne syllables
 where
  buildOne syllable
    | syllableInfoActualCount syllable <= syllableInfoExpectedCount syllable = []
    | otherwise =
        let word = syllableInfoWord syllable
            textRange = findTokenRangeForWord tokens tokenCount word
            insertedVowels = syllableInfoInsertedVowels syllable
            (insertedVowelIpa, insertionMs) = case insertedVowels of
              (iv : _) -> (Just (insertedVowelPhoneme iv), Just (insertedVowelPositionMs iv))
              [] -> (Nothing, Nothing)
            (catalogId, flText) = catalogRef (lookupByPhoneme "C")
         in [ AssessmentFinding
                { findingCategory = FindingCategoryPronunciation,
                  findingSeverity = FindingSeverityMajor,
                  findingTextRange = textRange,
                  findingAudioRange = Nothing,
                  findingExpected =
                    PronunciationEvidence
                      { evidenceText = Just word,
                        evidenceIpa = Nothing
                      },
                  findingDetected =
                    PronunciationEvidence
                      { evidenceText = Just word,
                        evidenceIpa = Nothing
                      },
                  findingMessageJa = Nothing,
                  findingMessageEn = Nothing,
                  findingScoreImpact = severityToScoreImpact FindingSeverityMajor,
                  findingConfidence = epenthesisFindingConfidence,
                  findingPhenomenon = "epenthesis",
                  findingGop = Nothing,
                  findingDetectedTopCandidate = Nothing,
                  findingNBest = Nothing,
                  findingMatchesL1Pattern = True,
                  findingFunctionalLoad = flText,
                  findingCatalogId = catalogId,
                  findingWordPair = Nothing,
                  findingExpectedPronunciation = Nothing,
                  findingInsertedVowel = insertedVowelIpa,
                  findingInsertionPositionMs = insertionMs,
                  findingWordPositionLabel = Nothing,
                  findingAcousticEvidence = Nothing,
                  findingArticulatoryEstimate = Nothing
                }
            ]

-- | lexicalStress finding の confidence（固定値、W12 で命名）。
lexicalStressFindingConfidence :: Double
lexicalStressFindingConfidence = 0.70

-- | lexicalStress finding を語強勢データから生成する（M-102）。
buildLexicalStressFindings ::
  Text ->
  [WordStress] ->
  Int ->
  [TokenSegment] ->
  [AssessmentFinding]
buildLexicalStressFindings _sectionBodyText wordStresses tokenCount tokens =
  mapMaybe buildOne wordStresses
 where
  buildOne wordStress
    | wordStressExpected wordStress == wordStressPredicted wordStress = Nothing
    | otherwise =
        let word = wordStressWord wordStress
            textRange = findTokenRangeForWord tokens tokenCount word
            (catalogId, flText) = catalogRef (lookupByPhoneme "σ")
         in Just
              AssessmentFinding
                { findingCategory = FindingCategoryProsody,
                  findingSeverity = FindingSeverityMinor,
                  findingTextRange = textRange,
                  findingAudioRange =
                    Just
                      AudioRange
                        { startMs = wordStressStartMs wordStress,
                          endMs = wordStressEndMs wordStress
                        },
                  findingExpected =
                    PronunciationEvidence
                      { evidenceText = Just word,
                        evidenceIpa = Nothing
                      },
                  findingDetected =
                    PronunciationEvidence
                      { evidenceText = Just word,
                        evidenceIpa = Nothing
                      },
                  findingMessageJa = Nothing,
                  findingMessageEn = Nothing,
                  findingScoreImpact = severityToScoreImpact FindingSeverityMinor,
                  findingConfidence = lexicalStressFindingConfidence,
                  findingPhenomenon = "lexicalStress",
                  findingGop = Nothing,
                  findingDetectedTopCandidate = Nothing,
                  findingNBest = Nothing,
                  findingMatchesL1Pattern = True,
                  findingFunctionalLoad = flText,
                  findingCatalogId = catalogId,
                  findingWordPair = Nothing,
                  findingExpectedPronunciation = Nothing,
                  findingInsertedVowel = Nothing,
                  findingInsertionPositionMs = Nothing,
                  findingWordPositionLabel = Nothing,
                  findingAcousticEvidence = Nothing,
                  findingArticulatoryEstimate = Nothing
                }

-- | weakForm finding の confidence（固定値、W12 で命名）。
weakFormFindingConfidence :: Double
weakFormFindingConfidence = 0.65

-- | weakForm finding を弱形実現データから生成する（M-102/M-109）。
buildWeakFormFindings ::
  Text ->
  [WeakFormRealization] ->
  Int ->
  [TokenSegment] ->
  [AssessmentFinding]
buildWeakFormFindings _sectionBodyText weakForms tokenCount tokens =
  mapMaybe buildOne weakForms
 where
  buildOne weakForm
    | not (weakFormExpectedWeak weakForm) = Nothing
    | weakFormRealizedWeak weakForm = Nothing
    | otherwise =
        let word = weakFormWord weakForm
            textRange = findTokenRangeForWord tokens tokenCount word
            (catalogId, flText) = catalogRef (lookupByPhoneme "Fw")
         in Just
              AssessmentFinding
                { findingCategory = FindingCategoryConnectedSpeech,
                  findingSeverity = FindingSeveritySuggestion,
                  findingTextRange = textRange,
                  findingAudioRange =
                    Just
                      AudioRange
                        { startMs = weakFormStartMs weakForm,
                          endMs = weakFormEndMs weakForm
                        },
                  findingExpected =
                    PronunciationEvidence
                      { evidenceText = Just word,
                        evidenceIpa = Nothing
                      },
                  findingDetected =
                    PronunciationEvidence
                      { evidenceText = Just word,
                        evidenceIpa = Nothing
                      },
                  findingMessageJa = Nothing,
                  findingMessageEn = Nothing,
                  findingScoreImpact = 0.0,
                  findingConfidence = weakFormFindingConfidence,
                  findingPhenomenon = "weakForm",
                  findingGop = Nothing,
                  findingDetectedTopCandidate = Nothing,
                  findingNBest = Nothing,
                  findingMatchesL1Pattern = True,
                  findingFunctionalLoad = flText,
                  findingCatalogId = catalogId,
                  findingWordPair = Nothing,
                  findingExpectedPronunciation = Nothing,
                  findingInsertedVowel = Nothing,
                  findingInsertionPositionMs = Nothing,
                  findingWordPositionLabel = Nothing,
                  findingAcousticEvidence = Nothing,
                  findingArticulatoryEstimate = Nothing
                }

-- ---- connected speech 4 現象 producers（M-102R-a） ----

-- | linking gap 閾値（ミリ秒）。calibratable threshold
linkingGapThresholdMs :: Int
linkingGapThresholdMs = 50

-- | flap 持続時間閾値（ミリ秒）。calibratable threshold
flapDurationThresholdMs :: Int
flapDurationThresholdMs = 60

-- | reduction 持続時間閾値（ミリ秒）。calibratable threshold
reductionDurationThresholdMs :: Int
reductionDurationThresholdMs = 80

-- | connected speech finding テンプレートの confidence（固定値、W12 で命名）。
connectedSpeechFindingConfidence :: Double
connectedSpeechFindingConfidence = 0.65

-- | 空の connected speech finding テンプレート。
connectedSpeechFindingBase :: TextRange -> AssessmentFinding
connectedSpeechFindingBase textRange =
  AssessmentFinding
    { findingCategory = FindingCategoryConnectedSpeech,
      findingSeverity = FindingSeveritySuggestion,
      findingTextRange = textRange,
      findingAudioRange = Nothing,
      findingExpected = PronunciationEvidence {evidenceText = Nothing, evidenceIpa = Nothing},
      findingDetected = PronunciationEvidence {evidenceText = Nothing, evidenceIpa = Nothing},
      findingMessageJa = Nothing,
      findingMessageEn = Nothing,
      findingScoreImpact = 0.0,
      findingConfidence = connectedSpeechFindingConfidence,
      findingPhenomenon = "",
      findingGop = Nothing,
      findingDetectedTopCandidate = Nothing,
      findingNBest = Nothing,
      findingMatchesL1Pattern = False,
      findingFunctionalLoad = Nothing,
      findingCatalogId = Nothing,
      findingWordPair = Nothing,
      findingExpectedPronunciation = Nothing,
      findingInsertedVowel = Nothing,
      findingInsertionPositionMs = Nothing,
      findingWordPositionLabel = Nothing,
      findingAcousticEvidence = Nothing,
      findingArticulatoryEstimate = Nothing
    }

-- | linking: 単語末子音終端と次語頭母音開始の gap < 50ms かつ境界で音声が連続している現象。
-- silenceDurationMs < linkingGapThresholdMs の単語間無音区間を linking 候補と判定する。
buildLinkingFindings ::
  [InterWordSilence] ->
  [PhonemeGop] ->
  [TokenSegment] ->
  Int ->
  [AssessmentFinding]
buildLinkingFindings silences _phonemeGops tokens tokenCount =
  mapMaybe buildOne silences
 where
  buildOne silence
    | silenceDurationMs silence >= linkingGapThresholdMs = Nothing
    | otherwise =
        let textRange = findTextRangeForTime tokens tokenCount (silenceStartMs silence)
            base = connectedSpeechFindingBase textRange
         in Just
              base
                { findingPhenomenon = "linking",
                  findingAudioRange =
                    Just
                      AudioRange
                        { startMs = silenceStartMs silence,
                          endMs = silenceEndMs silence
                        }
                }

-- | フラップ化対象の期待音素セット（/t/ /d/）。
flapTargetPhonemes :: [Text]
flapTargetPhonemes = ["t", "d"]

-- | NBest 候補に含まれるフラップ音。
flapPhonemes :: [Text]
flapPhonemes = ["ɾ", "r"]

-- | flap: 期待音素 /t/ /d/ が母音間で 60ms 未満に実現、または NBest に ɾ が出る現象。
buildFlapFindings ::
  [PhonemeGop] ->
  [TokenSegment] ->
  Int ->
  [AssessmentFinding]
buildFlapFindings phonemeGops tokens tokenCount =
  mapMaybe buildOne phonemeGops
 where
  buildOne phonemeGop
    | gopPhoneme phonemeGop `notElem` flapTargetPhonemes = Nothing
    | isFlapSignal phonemeGop =
        let textRange = findTextRangeForTime tokens tokenCount (gopStartMs phonemeGop)
            base = connectedSpeechFindingBase textRange
         in Just
              base
                { findingPhenomenon = "flap",
                  findingAudioRange =
                    Just
                      AudioRange
                        { startMs = gopStartMs phonemeGop,
                          endMs = gopEndMs phonemeGop
                        },
                  findingNBest = toNBestOutput (gopNBest phonemeGop)
                }
    | otherwise = Nothing

  isFlapSignal pg =
    let durationMs = gopEndMs pg - gopStartMs pg
        hasShortDuration = durationMs < flapDurationThresholdMs
        hasRhoticNBest = any (\e -> nBestPhoneme e `elem` flapPhonemes) (gopNBest pg)
     in hasShortDuration || hasRhoticNBest

-- | 同化対象の期待音素→後続調音点音素の文脈マップ。
-- キー: (期待音素, 後続音素クラス) → 同化後 NBest 期待音素。
assimilationContexts :: [(Text, [Text], [Text])]
assimilationContexts =
  [ -- /n/ の前に /p,b,m/ が続く→ /m/ に同化
    ("n", ["p", "b", "m"], ["m"]),
    -- /n/ の前に /k,g/ が続く→ /ŋ/ に同化
    ("n", ["k", "g"], ["ŋ"]),
    -- /d/ の前に /j/ が続く→ /dʒ/ に同化
    ("d", ["j"], ["dʒ", "ʤ"])
  ]

-- | assimilation: 後続調音点への同化が NBest 上位候補に現れる現象。
buildAssimilationFindings ::
  [PhonemeGop] ->
  [TokenSegment] ->
  Int ->
  [AssessmentFinding]
buildAssimilationFindings phonemeGops tokens tokenCount =
  mapMaybe buildOne (zip [0 ..] phonemeGops)
 where
  buildOne (index, phonemeGop) =
    let nextPhoneme = case drop (index + 1) phonemeGops of
          (next : _) -> Just (gopPhoneme next)
          [] -> Nothing
        assimilationResult = checkAssimilation (gopPhoneme phonemeGop) nextPhoneme (gopNBest phonemeGop)
     in case assimilationResult of
          Nothing -> Nothing
          Just _ ->
            let textRange = findTextRangeForTime tokens tokenCount (gopStartMs phonemeGop)
                base = connectedSpeechFindingBase textRange
             in Just
                  base
                    { findingPhenomenon = "assimilation",
                      findingAudioRange =
                        Just
                          AudioRange
                            { startMs = gopStartMs phonemeGop,
                              endMs = gopEndMs phonemeGop
                            },
                      findingNBest = toNBestOutput (gopNBest phonemeGop)
                    }

  checkAssimilation expectedPhoneme maybeNextPhoneme nBestEntries =
    case maybeNextPhoneme of
      Nothing -> Nothing
      Just nextPhoneme ->
        let matchingContext =
              Data.List.find
                ( \(expected, followingSet, _) ->
                    expected == expectedPhoneme
                      && nextPhoneme `elem` followingSet
                )
                assimilationContexts
         in case matchingContext of
              Nothing -> Nothing
              Just (_, _, assimilatedPhonemes) ->
                Data.List.find
                  (\e -> nBestPhoneme e `elem` assimilatedPhonemes)
                  nBestEntries

-- | 機能語の期待フル母音セット。これらが実際にシュワー等に短縮された場合を reduction とする。
fullVowelPhonemes :: [Text]
fullVowelPhonemes = ["æ", "ɛ", "ɪ", "ʌ", "ɒ", "ɔ", "ʊ", "uː", "iː", "eɪ", "aɪ", "ɔɪ", "aʊ", "oʊ"]

-- | reduction: 機能語/無強勢の期待フル母音がシュワー化 + 80ms 未満に実現する現象。
-- weakForm（辞書弱形語の強形/弱形実現）と区別: reduction は音響的母音弱化（単語依存しない）。
buildReductionFindings ::
  [SchwaRealization] ->
  [WeakFormRealization] ->
  [PhonemeGop] ->
  [TokenSegment] ->
  Int ->
  [AssessmentFinding]
buildReductionFindings schwaRealizations weakFormRealizations phonemeGops tokens tokenCount =
  mapMaybe buildOne phonemeGops
 where
  -- 弱形辞書語の時間帯に含まれる音素は weakForm に任せて重複しない
  weakFormRanges = [(weakFormStartMs wf, weakFormEndMs wf) | wf <- weakFormRealizations]

  isInWeakFormRange startMs =
    any (\(startRange, endRange) -> startMs >= startRange && startMs < endRange) weakFormRanges

  buildOne phonemeGop
    | gopPhoneme phonemeGop `notElem` fullVowelPhonemes = Nothing
    | isInWeakFormRange (gopStartMs phonemeGop) = Nothing
    | isReductionSignal phonemeGop = buildReductionFinding phonemeGop
    | otherwise = Nothing

  isReductionSignal pg =
    let durationMs = gopEndMs pg - gopStartMs pg
        hasShortDuration = durationMs < reductionDurationThresholdMs
        -- SchwaRealization でシュワー実現とマークされた音素と時間帯が重なるか確認
        hasSchwaSignal =
          any
            ( \sr ->
                schwaRealized sr
                  && schwaStartMs sr <= gopStartMs pg
                  && schwaEndMs sr >= gopEndMs pg
            )
            schwaRealizations
     in hasShortDuration && hasSchwaSignal

  buildReductionFinding pg =
    let textRange = findTextRangeForTime tokens tokenCount (gopStartMs pg)
        base = connectedSpeechFindingBase textRange
     in Just
          base
            { findingPhenomenon = "reduction",
              findingAudioRange =
                Just
                  AudioRange
                    { startMs = gopStartMs pg,
                      endMs = gopEndMs pg
                    }
            }

-- ---- 音素分類ユーティリティ ----

gopToSeverity :: Double -> Maybe FindingSeverity
gopToSeverity gop
  | gop < gopMajorThreshold = Just FindingSeverityMajor
  | gop < gopMinorThreshold = Just FindingSeverityMinor
  | otherwise = Nothing

severityToScoreImpact :: FindingSeverity -> Double
severityToScoreImpact FindingSeverityCritical = -8.0
severityToScoreImpact FindingSeverityMajor = -5.0
severityToScoreImpact FindingSeverityMinor = -2.0
severityToScoreImpact FindingSeveritySuggestion = 0.0

severityToConfidence :: FindingSeverity -> Double
severityToConfidence FindingSeverityCritical = 0.9
severityToConfidence FindingSeverityMajor = 0.8
severityToConfidence FindingSeverityMinor = 0.7
severityToConfidence FindingSeveritySuggestion = 0.6

-- | expected IPA / detected IPA / 対象音素から phenomenon を分類する。
classifyPhenomenon :: Text -> Text -> Text -> Text
classifyPhenomenon expectedIpa detectedIpa phoneme =
  let expectedChars = Text.unpack expectedIpa
      detectedChars = Text.unpack detectedIpa
      phonemeStr = Text.unpack phoneme
      inExpected = phonemeStr `isSubsequenceOf` expectedChars
      inDetected = phonemeStr `isSubsequenceOf` detectedChars
   in case (inExpected, inDetected) of
        (True, False) -> "omission"
        (False, True) -> "insertion"
        _ -> "substitution"

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
  let tokenIndex = min (tokenCount - 1) (startMilliseconds * tokenCount `div` max 1 startMilliseconds)
      safeIndex = max 0 (min (tokenCount - 1) tokenIndex)
      token = tokens !! safeIndex
   in TextRange
        { startChar = tokenStartChar token,
          endChar = tokenEndChar token
        }

-- | 単語テキストから最も近い TokenSegment の TextRange を返す。
findTokenRangeForWord :: [TokenSegment] -> Int -> Text -> TextRange
findTokenRangeForWord [] _ _ = TextRange {startChar = 0, endChar = 0}
findTokenRangeForWord tokens tokenCount word =
  let matchingToken = Data.List.find (\t -> Text.toLower (tokenText t) == Text.toLower word) tokens
   in case matchingToken of
        Just token -> TextRange {startChar = tokenStartChar token, endChar = tokenEndChar token}
        Nothing ->
          let safeIndex = max 0 (min (tokenCount - 1) 0)
              token = tokens !! safeIndex
           in TextRange {startChar = tokenStartChar token, endChar = tokenEndChar token}

-- ---- ScoringOutput から AssessmentScores への変換 ----

buildAssessmentScores :: ScoringOutput -> [AssessmentFinding] -> AssessmentScores
buildAssessmentScores scoringOutput findings =
  let intelligibilityScore = computeIntelligibilityScore findings
      segmentalScore = scorePronunciation scoringOutput
      prosodicScore = scoreProsody scoringOutput
   in AssessmentScores
        { overall = scoreOverall scoringOutput,
          accuracy = scoreAccuracy scoringOutput,
          nativeLikeness = scoreNativeLikeness scoringOutput,
          pronunciation = scorePronunciation scoringOutput,
          connectedSpeech = scoreConnectedSpeech scoringOutput,
          prosody = scoreProsody scoringOutput,
          intelligibility = intelligibilityScore,
          cefrOverall = buildCefrScore (scoreOverall scoringOutput),
          cefrSegmental = buildCefrScore segmentalScore,
          cefrProsodic = buildCefrScore prosodicScore
        }

-- ---- 全音素 GOP ヒートマップ（M-107c） ----

-- | GOP ヒートマップエントリを生成する。heat=0..4（GOP>=-2→0, <-12→4）。
buildPerPhonemeHeatmap :: [PhonemeGop] -> [TokenSegment] -> Int -> [PhonemeHeatEntry]
buildPerPhonemeHeatmap phonemeGops tokens tokenCount =
  zipWith (buildHeatEntry tokens tokenCount) (inferWordAssignment phonemeGops tokenCount) phonemeGops

inferWordAssignment :: [PhonemeGop] -> Int -> [Text]
inferWordAssignment phonemeGops tokenCount =
  let total = length phonemeGops
      wordsPerPhoneme = if tokenCount > 0 then max 1 (total `div` tokenCount) else 1
      indexed = zip [0 ..] phonemeGops
   in map (\(i, _) -> "word" <> Text.pack (show (i `div` wordsPerPhoneme + 1))) indexed

buildHeatEntry :: [TokenSegment] -> Int -> Text -> PhonemeGop -> PhonemeHeatEntry
buildHeatEntry tokens tokenCount wordLabel pg =
  let gop = gopValue pg
      heat = gopToHeat gop
      wordText = case tokens of
        [] -> wordLabel
        _ ->
          let tokenIndex = max 0 (min (tokenCount - 1) 0)
           in tokenText (tokens !! tokenIndex)
   in PhonemeHeatEntry
        { heatWord = wordText,
          heatPhoneme = gopPhoneme pg,
          heatGop = gop,
          heatLevel = heat
        }

gopToHeat :: Double -> Int
gopToHeat gop
  | gop >= gopCeiling = 0
  | gop >= gopHeatLevel1Threshold = 1
  | gop >= gopMinorThreshold = 2
  | gop >= gopMajorThreshold = 3
  | otherwise = 4

-- ---- Focus sounds（M-112） ----

-- | finding リストから focus sounds を生成する。
buildFocusSounds :: [AssessmentFinding] -> [FocusSound]
buildFocusSounds findings =
  let byPhenomenon = groupByPhenomenon findings
      focusList = map buildFocusEntry byPhenomenon
      sorted = sortBy (comparing (Down . focusSoundPriorityOrder)) focusList
   in sorted

focusSoundPriorityOrder :: FocusSound -> Int
focusSoundPriorityOrder fs = case focusPriority fs of
  "now" -> 3
  "next" -> 2
  "later" -> 1
  _ -> 0

groupByPhenomenon :: [AssessmentFinding] -> [(Text, [AssessmentFinding])]
groupByPhenomenon findings =
  let phenomena = nub $ map findingPhenomenon findings
   in map (\ph -> (ph, filter (\f -> findingPhenomenon f == ph) findings)) phenomena

buildFocusEntry :: (Text, [AssessmentFinding]) -> FocusSound
buildFocusEntry (phenomenon, fs) =
  let occurrences = length fs
      representativeFL = case mapMaybe findingFunctionalLoad fs of
        (fl : _) -> fl
        [] -> "mid"
      priority = computePriority representativeFL occurrences
      pairText = case phenomenon of
        "substitution" -> case mapMaybe findingDetectedTopCandidate fs of
          (top : _) -> case mapMaybe (\f -> case findingGop f of Just _ -> Just (findingExpected f); Nothing -> Nothing) fs of
            (ev : _) -> fromMaybe phenomenon (evidenceIpa ev) <> "/" <> top
            [] -> phenomenon
          [] -> phenomenon
        "epenthesis" -> "母音挿入"
        "lexicalStress" -> "語強勢"
        "weakForm" -> "弱形"
        other -> other
      catalogId = case mapMaybe findingCatalogId fs of
        (cid : _) -> Just cid
        [] -> Nothing
      reasonJa = case catalogId of
        Just cid -> case filter (\e -> catalogIdentifier e == cid) catalog of
          (entry : _) -> catalogReasonJa entry
          [] -> phenomenon <> "の誤りが検出されました。"
        Nothing -> phenomenon <> "の誤りが検出されました。"
   in FocusSound
        { focusPair = pairText,
          focusPhenomenon = Just phenomenon,
          focusFunctionalLoad = representativeFL,
          focusOccurrences = occurrences,
          focusPriority = priority,
          focusReasonJa = reasonJa,
          focusCatalogId = catalogId
        }

-- | priority 算出の FL ランク別スコア（calibratable threshold、W12 で命名）。
priorityFlScoreMax :: Int
priorityFlScoreMax = 4

priorityFlScoreHigh :: Int
priorityFlScoreHigh = 3

priorityFlScoreMid :: Int
priorityFlScoreMid = 2

priorityFlScoreLow :: Int
priorityFlScoreLow = 1

-- | priority "now" 判定閾値（calibratable threshold、W12 で命名）。
priorityNowThreshold :: Int
priorityNowThreshold = 6

-- | priority "next" 判定閾値（calibratable threshold、W12 で命名）。
priorityNextThreshold :: Int
priorityNextThreshold = 3

-- | priority を FL × 出現頻度から算出する。
computePriority :: Text -> Int -> Text
computePriority flText occurrences =
  let flScore = case flText of
        "max" -> priorityFlScoreMax
        "high" -> priorityFlScoreHigh
        "mid" -> priorityFlScoreMid
        "low" -> priorityFlScoreLow
        _ -> priorityFlScoreLow :: Int
      score = flScore * occurrences
   in if score >= priorityNowThreshold
        then "now"
        else
          if score >= priorityNextThreshold
            then "next"
            else "later"

-- ---- Prosody 出力（M-114） ----

-- | referenceNpvi の既定値（Rhythm 情報欠落時のフォールバック、calibratable threshold、W12 で命名）。
defaultReferenceNpvi :: Double
defaultReferenceNpvi = 65.0

-- | AnalyzerResult から ProsodyOutput を生成する。
buildProsodyOutput :: AnalyzerResult -> Maybe ProsodyOutput
buildProsodyOutput analyzerResult =
  case analyzedF0Contour analyzerResult of
    Nothing ->
      if null (analyzedWordStress analyzerResult) && null (analyzedWeakFormRealizations analyzerResult)
        then Nothing
        else Just (buildProsodyOutputFromData analyzerResult)
    Just _ -> Just (buildProsodyOutputFromData analyzerResult)

buildProsodyOutputFromData :: AnalyzerResult -> ProsodyOutput
buildProsodyOutputFromData analyzerResult =
  let f0Times = maybe [] f0TimesMs (analyzedF0Contour analyzerResult)
      f0Values = maybe [] f0ValuesHz (analyzedF0Contour analyzerResult)
      refF0Times = maybe [] f0TimesMs (analyzedReferenceF0Contour analyzerResult)
      refF0Values = maybe [] f0ValuesHz (analyzedReferenceF0Contour analyzerResult)
      wordStressOutputs =
        map
          ( \ws ->
              WordStressOutput
                { wordStressOutputWord = wordStressWord ws,
                  wordStressOutputWordIndex = wordStressWordIndex ws,
                  wordStressOutputExpected = wordStressExpected ws,
                  wordStressOutputPredicted = wordStressPredicted ws
                }
          )
          (analyzedWordStress analyzerResult)
      npvi = maybe 0.0 rhythmNpviVocalic (analyzedRhythm analyzerResult)
      refNpvi = maybe defaultReferenceNpvi rhythmReferenceNpviVocalic (analyzedRhythm analyzerResult)
      weakFormRate = computeWeakFormRate (analyzedWeakFormRealizations analyzerResult)
   in ProsodyOutput
        { prosodyF0TimesMs = f0Times,
          prosodyF0ValuesHz = f0Values,
          prosodyReferenceF0TimesMs = refF0Times,
          prosodyReferenceF0ValuesHz = refF0Values,
          prosodyWordStress = wordStressOutputs,
          prosodyRhythmNpvi = npvi,
          prosodyReferenceNpvi = refNpvi,
          prosodyWeakFormRate = weakFormRate
        }

computeWeakFormRate :: [WeakFormRealization] -> Double
computeWeakFormRate [] = 1.0
computeWeakFormRate weakForms =
  let expectedForms = filter weakFormExpectedWeak weakForms
   in if null expectedForms
        then 1.0
        else
          let realizedCount = fromIntegral $ length $ filter weakFormRealizedWeak expectedForms
           in realizedCount / fromIntegral (length expectedForms)

-- ---- 動的サマリー（M-107b） ----

-- | 固定3段廃止。最優先 focus sound + 改善点を含む動的サマリーを生成する。
buildDynamicSummary :: [FocusSound] -> ScoringOutput -> Text
buildDynamicSummary [] scoringOutput =
  buildFallbackSummary scoringOutput
buildDynamicSummary focusSounds scoringOutput =
  let topFocus = head focusSounds
      focusPart = "最も優先すべき改善点: " <> focusPair topFocus <> "。" <> focusReasonJa topFocus
      overallScore = scoreOverall scoringOutput
      overallPart
        | overallScore >= 80 = "全体的に良好な発音です。"
        | overallScore >= 60 = "基本的な発音は概ね良好です。"
        | otherwise = "継続的な発音練習が必要です。"
   in overallPart <> focusPart

buildFallbackSummary :: ScoringOutput -> Text
buildFallbackSummary scoringOutput =
  let overallScore = scoreOverall scoringOutput
   in if overallScore >= 80
        then "全体的に良好な発音です。引き続き練習を続けましょう。"
        else
          if overallScore >= 60
            then "概ね良好な発音です。連結発話とリズムを意識して練習しましょう。"
            else "基本的な発音練習を継続しましょう。特に音素の正確な産出に注目してください。"

-- ---- GOP Delta 分類 (M-CRL-7 / ADR-022) ----

-- | deltaSignal の改善閾値（calibratable）。この値より大きければ improved。
gopDeltaImprovementThreshold :: Double
gopDeltaImprovementThreshold = 5.0

-- | deltaSignal の退行閾値（calibratable）。この値より小さければ regressed。
gopDeltaRegressionThreshold :: Double
gopDeltaRegressionThreshold = -2.0

-- | (originalGop, retryGop) から boundarySignal を計算する。
-- major→(minor|none) = crossedMajor、(major|minor)→none = crossedMinor、それ以外 = none。
classifyBoundarySignal :: Double -> Double -> BoundarySignal
classifyBoundarySignal originalGop retryGop =
  case (gopToSeverity originalGop, gopToSeverity retryGop) of
    (Just FindingSeverityMajor, Just FindingSeverityMinor) -> BoundarySignalCrossedMajor
    (Just FindingSeverityMajor, Nothing) -> BoundarySignalCrossedMajor
    (Just FindingSeverityMinor, Nothing) -> BoundarySignalCrossedMinor
    _ -> BoundarySignalNone

-- | GOP delta 分類の純粋関数（M-CRL-7 / ADR-022）。
-- originalGop と retryGop を受け取り gopDelta / deltaSignal / boundarySignal /
-- retrySeverity / retryConfidence を返す（M-CRL-11 / ADR-022 D14）。
-- retryConfidence の none ケース PIN: none → 0.6（severityToConfidence の最下位 tier 再利用、calibratable）。
classifyGopDelta :: Double -> Double -> GopDeltaResponse
classifyGopDelta originalGop retryGop =
  let gopDelta = retryGop - originalGop
      deltaSignal
        | gopDelta > gopDeltaImprovementThreshold = DeltaSignalImproved
        | gopDelta < gopDeltaRegressionThreshold = DeltaSignalRegressed
        | otherwise = DeltaSignalUnchanged
      boundarySignal = classifyBoundarySignal originalGop retryGop
      retrySeverity = gopToSeverity retryGop
      retryConfidence = maybe 0.6 severityToConfidence retrySeverity
   in GopDeltaResponse
        { gopDeltaResponseGopDelta = gopDelta,
          gopDeltaResponseDeltaSignal = deltaSignal,
          gopDeltaResponseBoundarySignal = boundarySignal,
          gopDeltaResponseRetrySeverity = retrySeverity,
          gopDeltaResponseRetryConfidence = retryConfidence
        }
