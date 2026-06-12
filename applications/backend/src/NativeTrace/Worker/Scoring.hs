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
  -- 後方互換: 既存 Assessment.hs が参照する名前を re-export する
  scoreAssessment,
  generateFindings,
  -- 音質ガード
  checkAudioQuality,
  audioQualityMinMeanDbfs,
  audioQualityMinRecordingDurationMs,
  audioQualityMinPhonemeDetectionRate,
  audioQualityMaxMedianGop,
  -- 新規 export
  buildPerPhonemeHeatmap,
  buildFocusSounds,
  buildProsodyOutput,
  buildDynamicSummary,
)
where

import Data.Char (isSpace)
import Data.List (find, foldl', group, nub, sort, sortBy)
import Data.Maybe (fromMaybe, mapMaybe)
import Data.Ord (Down (..), comparing)
import Data.Text (Text)
import Data.Text qualified as Text
import NativeTrace.Worker.AnalyzerClient (
  AnalyzerResult (..),
  F0Contour (..),
  InsertedVowelInfo (..),
  InterWordSilence (..),
  NBestEntry (..),
  PhonemeGop (..),
  Rhythm (..),
  SchwaRealization (..),
  SyllableInfo (..),
  WeakFormRealization (..),
  WordStress (..),
 )
import NativeTrace.Worker.Catalog (
  CatalogEntry (..),
  FunctionalLoad (..),
  catalog,
  flRank,
  flWeight,
  lookupByConfusion,
  lookupByPhoneme,
 )
import NativeTrace.Worker.Types (
  AssessmentFinding (..),
  AssessmentScores (..),
  AudioRange (..),
  CefrScore (..),
  FindingCategory (..),
  FindingSeverity (..),
  FocusSound (..),
  NBestOutputEntry (..),
  PhonemeHeatEntry (..),
  PronunciationEvidence (..),
  ProsodyOutput (..),
  TextRange (..),
  WordPair (..),
  WordStressOutput (..),
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
    scoreIntelligibility :: Int,
    outputTokens :: [TokenSegment],
    summaryMessageJa :: Text,
    summaryMessageEn :: Text
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

-- | connectedSpeech スコアの無音長ペナルティ閾値（ミリ秒）。calibratable threshold
silencePenaltyThresholdMs :: Int
silencePenaltyThresholdMs = 500

-- | connectedSpeech スコアの話速ペナルティ閾値（音素/秒）の上限。calibratable threshold
speechRateUpperThreshold :: Double
speechRateUpperThreshold = 15.0

-- | connectedSpeech スコアの話速ペナルティ閾値（音素/秒）の下限。calibratable threshold
speechRateLowerThreshold :: Double
speechRateLowerThreshold = 3.0

-- ---- 音質ガード定数（calibratable threshold） ----

audioQualityMinMeanDbfs :: Double
audioQualityMinMeanDbfs = -35.0

audioQualityMinRecordingDurationMs :: Int
audioQualityMinRecordingDurationMs = 1000

audioQualityMinPhonemeDetectionRate :: Double
audioQualityMinPhonemeDetectionRate = 0.25

audioQualityMaxMedianGop :: Double
audioQualityMaxMedianGop = -18.0

-- | 音声品質チェック。低品質なら True を返す。
checkAudioQuality ::
  Double -> Int -> Int -> Int -> [Double] -> Bool
checkAudioQuality meanDbfs durationMilliseconds detectedPhonemeCount expectedPhonemeCount gopValues =
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
  let base = 75 :: Int
      longSilenceCount =
        length $
          filter
            (\s -> silenceDurationMs s > silencePenaltyThresholdMs)
            silences
      silencePenalty = min 20 (longSilenceCount * 5)
      schwaTotal = length schwaRealizations
      schwaRealizedCount = length (filter schwaRealized schwaRealizations)
      schwaPenalty =
        if schwaTotal == 0
          then 0
          else
            let unrealizedRate = fromIntegral (schwaTotal - schwaRealizedCount) / fromIntegral schwaTotal :: Double
             in round (unrealizedRate * 10.0) :: Int
      ratePenalty =
        if speechRate < speechRateLowerThreshold || speechRate > speechRateUpperThreshold
          then 10
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
           in round ((matchRate - 0.5) * 10.0) :: Int

-- ---- prosody スコア（stress + nPVI + 弱形実現率、M-114） ----

-- | prosody スコアを語強勢精度・nPVI 近接度・弱形実現率から算出する。
computeProsodyScore :: [WordStress] -> Maybe Rhythm -> [WeakFormRealization] -> Int
computeProsodyScore wordStresses maybeRhythm weakFormRealizations =
  let base = 65 :: Int
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
   in round (errorRate * 20.0) :: Int

computeNpviPenalty :: Maybe Rhythm -> Int
computeNpviPenalty Nothing = 0
computeNpviPenalty (Just rhythm) =
  let npvi = rhythmNpviVocalic rhythm
      refNpvi = rhythmReferenceNpviVocalic rhythm
      deviation = abs (npvi - refNpvi)
   in min 15 (round (deviation / 5.0) :: Int)

computeWeakFormPenalty :: [WeakFormRealization] -> Int
computeWeakFormPenalty [] = 0
computeWeakFormPenalty weakForms =
  let expectedWeakForms = filter weakFormExpectedWeak weakForms
   in if null expectedWeakForms
        then 0
        else
          let unrealizedCount = length $ filter (not . weakFormRealizedWeak) expectedWeakForms
              unrealizedRate = fromIntegral unrealizedCount / fromIntegral (length expectedWeakForms) :: Double
           in round (unrealizedRate * 10.0) :: Int

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

scoreToCefrBand :: Int -> Text
scoreToCefrBand score
  | score >= 80 = "C1"
  | score >= 70 = "B2"
  | score >= 55 = "B1+"
  | score >= 40 = "B1"
  | otherwise = "A2"

buildCefrScore :: Int -> CefrScore
buildCefrScore score = CefrScore {cefrScoreValue = score, cefrBand = scoreToCefrBand score}

-- ---- GOP ベースのスコアリング ----

scoreFromGop :: AnalyzerResult -> ScoringOutput -> ScoringOutput
scoreFromGop result scoringOutput =
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
      -- intelligibility はまず findings なしで算出（後で findings から上書き可）
      intelligibilityScore = clampScore overallScore
   in scoringOutput
        { scoreOverall = overallScore,
          scoreAccuracy = accuracyScore,
          scoreNativeLikeness = nativeLikenessScore,
          scorePronunciation = pronunciationScore,
          scoreConnectedSpeech = connectedSpeechScoreValue,
          scoreProsody = prosodyScore,
          scoreIntelligibility = intelligibilityScore
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
          (buildGopFinding tokenCount tokens expectedIpa detectedIpa)
          allPhonemeGops
      -- epenthesis findings（M-115）
      epenthesisFindings = buildEpenthesisFindings sectionBodyText (analyzedSyllables analyzerResult) tokenCount tokens
      -- lexicalStress findings（M-102）
      stressFindings = buildLexicalStressFindings sectionBodyText (analyzedWordStress analyzerResult) tokenCount tokens
      -- weakForm findings（M-102/M-114）
      weakFormFindings = buildWeakFormFindings sectionBodyText (analyzedWeakFormRealizations analyzerResult) tokenCount tokens
   in gopFindings <> epenthesisFindings <> stressFindings <> weakFormFindings

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
              -- NBest 照合（M-103）
              nBestEntries = gopNBest phonemeGop
              topCandidate = case nBestEntries of
                (top : _) -> Just (nBestPhoneme top)
                [] -> Nothing
              nBestOutput =
                if null nBestEntries
                  then Nothing
                  else
                    Just $
                      map
                        (\e -> NBestOutputEntry {nBestOutputPhoneme = nBestPhoneme e, nBestOutputConfidence = nBestConfidence e})
                        (take 3 nBestEntries)
              -- カタログ照合（M-101/M-103）
              catalogMatch = do
                detectedPhoneme <- topCandidate
                lookupByConfusion phoneme detectedPhoneme
              (matchesL1, catalogId, functionalLoadText) = case catalogMatch of
                Just entry ->
                  ( True,
                    Just (catalogIdentifier entry),
                    Just (flRank (catalogFunctionalLoad entry))
                  )
                Nothing ->
                  case lookupByPhoneme phoneme of
                    Just entry ->
                      ( False,
                        Just (catalogIdentifier entry),
                        Just (flRank (catalogFunctionalLoad entry))
                      )
                    Nothing -> (False, Nothing, Nothing)
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
                    findingInsertionPositionMs = Nothing
                  }
              ]

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
            catalogEntry = lookupByPhoneme "C"
            (catalogId, flText) = case catalogEntry of
              Just e -> (Just (catalogIdentifier e), Just (flRank (catalogFunctionalLoad e)))
              Nothing -> (Nothing, Nothing)
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
                  findingConfidence = 0.75,
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
                  findingInsertionPositionMs = insertionMs
                }
            ]

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
            catalogEntry = lookupByPhoneme "σ"
            (catalogId, flText) = case catalogEntry of
              Just e -> (Just (catalogIdentifier e), Just (flRank (catalogFunctionalLoad e)))
              Nothing -> (Nothing, Nothing)
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
                  findingConfidence = 0.70,
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
                  findingInsertionPositionMs = Nothing
                }

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
            catalogEntry = lookupByPhoneme "Fw"
            (catalogId, flText) = case catalogEntry of
              Just e -> (Just (catalogIdentifier e), Just (flRank (catalogFunctionalLoad e)))
              Nothing -> (Nothing, Nothing)
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
                  findingConfidence = 0.65,
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
                  findingInsertionPositionMs = Nothing
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
  | gop >= -2.0 = 0
  | gop >= -5.0 = 1
  | gop >= -8.0 = 2
  | gop >= -12.0 = 3
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
        Just cid -> case filter (\e -> catalogIdentifier e == cid) catalogData of
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

-- | priority を FL × 出現頻度から算出する。
computePriority :: Text -> Int -> Text
computePriority flText occurrences =
  let flScore = case flText of
        "max" -> 4
        "high" -> 3
        "mid" -> 2
        "low" -> 1
        _ -> 1 :: Int
      score = flScore * occurrences
   in if score >= 6
        then "now"
        else
          if score >= 3
            then "next"
            else "later"

-- | Catalog データへの参照（M-112: focusSounds の reasonJa をカタログ由来にする）。
catalogData :: [CatalogEntry]
catalogData = catalog

-- ---- Prosody 出力（M-114） ----

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
      refNpvi = maybe 65.0 rhythmReferenceNpviVocalic (analyzedRhythm analyzerResult)
      weakFormRate = computeWeakFormRate (analyzedWeakFormRealizations analyzerResult)
   in ProsodyOutput
        { prosodyF0TimesMs = f0Times,
          prosodyF0ValuesHz = f0Values,
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

-- ---- 後方互換 API（Assessment.hs が呼ぶ） ----

scoreAssessment :: ScoringInput -> ScoringOutput
scoreAssessment input =
  let text = inputText input
      tokens = tokenize text
   in ScoringOutput
        { scoreOverall = 0,
          scoreAccuracy = 50,
          scoreNativeLikeness = 0,
          scorePronunciation = 0,
          scoreConnectedSpeech = 0,
          scoreProsody = 65,
          scoreIntelligibility = 0,
          outputTokens = tokens,
          summaryMessageJa = buildFallbackSummary (ScoringOutput 0 50 0 0 0 65 0 tokens "" ""),
          summaryMessageEn = ""
        }

generateFindings ::
  Text ->
  Int ->
  AssessmentScores ->
  [AssessmentFinding]
generateFindings _ _ _ = []
