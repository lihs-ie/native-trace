-- | 発音解析スコアリング（純粋関数）。
-- 実音声解析エンジンは MVP 範囲外。決定的なルールベース骨格で実装する。
-- 同一入力には必ず同一出力を返す（乱数・IO 不使用）。
module NativeTrace.Worker.Scoring (
  ScoringInput (..),
  ScoringOutput (..),
  TokenSegment (..),
  scoreAssessment,
  tokenize,
  generateFindings,
)
where

import Data.Bits (xor)
import Data.Char (isSpace, ord)
import Data.List (foldl')
import Data.Text (Text)
import Data.Text qualified as Text
import NativeTrace.Worker.Types (
  AssessmentFinding (..),
  AssessmentScores (..),
  AudioRange (..),
  FindingCategory (..),
  FindingSeverity (..),
  PronunciationEvidence (..),
  TextRange (..),
 )

-- ---- Types ----

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

-- ---- Tokenize ----

-- | sectionBodyText を空白・句読点で分割し、各トークンの文字 offset を保持する。
-- UTF-16 code unit offset（ASCII 範囲内で等価）。
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

-- ---- Deterministic hash ----

-- | テキスト・バイト長・時間から決定的ハッシュ値を生成する。
deterministicHash :: Text -> Int -> Int -> Int
deterministicHash text byteLength durationMs =
  let textHash = foldl' (\acc c -> acc * 31 `xor` ord c) 17 (Text.unpack text)
      combined = textHash * 1000003 + byteLength * 31337 + durationMs * 7919
   in abs combined

-- | 語のテキストから決定的ハッシュ値を生成する（findings 選定用）。
tokenHash :: Text -> Int -> Int
tokenHash text tokenIndex =
  let textHash = foldl' (\acc c -> acc * 31 `xor` ord c) 17 (Text.unpack text)
   in abs (textHash * 1000003 + tokenIndex * 7919)

-- | 0..100 に正規化する（種別ごとに異なるオフセットを加えて分散させる）。
normalizeScore :: Int -> Int -> Int
normalizeScore seed offset =
  let raw = (seed `xor` (seed `div` 256) `xor` offset) `mod` 100
   in clampScore (raw + 40)

-- | スコアを 0..100 に収める。
clampScore :: Int -> Int
clampScore n
  | n < 0 = 0
  | n > 100 = 100
  | otherwise = n

-- ---- Scoring ----

-- | 発音解析スコアを算出する（決定的・純粋）。
scoreAssessment :: ScoringInput -> ScoringOutput
scoreAssessment input =
  let text = inputText input
      byteLength = inputByteLength input
      durationMs = inputDurationMilliseconds input
      tokens = tokenize text
      tokenCount = max 1 (length tokens)

      -- 発話速度（wpm）= tokenCount / (durationMs / 60000)
      -- durationMs が 0 でも safe（tokenize で 0 になることはない）
      wordsPerMinute :: Double
      wordsPerMinute = fromIntegral tokenCount / (fromIntegral durationMs / 60000.0)

      -- ビットレート（bps）
      bitsPerSecond :: Double
      bitsPerSecond = fromIntegral byteLength * 8.0 / (fromIntegral durationMs / 1000.0)

      seed = deterministicHash text byteLength durationMs

      -- 各スコアはシードとオフセットから決定的に算出
      rawAccuracy = normalizeScore seed 0
      rawNativeLikeness = normalizeScore seed 11
      rawPronunciation = normalizeScore seed 23
      rawConnectedSpeech = normalizeScore seed 37
      rawProsody = normalizeScore seed 53

      -- 発話速度ペナルティ: 極端に速い/遅い場合に減点
      speedPenalty =
        if wordsPerMinute < 80 || wordsPerMinute > 200
          then 5
          else 0

      -- ビットレートボーナス（高品質音声）
      qualityBonus =
        if bitsPerSecond > 64000
          then 2
          else 0

      finalAccuracy = clampScore (rawAccuracy - speedPenalty + qualityBonus)
      finalNativeLikeness = clampScore (rawNativeLikeness - speedPenalty)
      finalPronunciation = clampScore (rawPronunciation - speedPenalty + qualityBonus)
      finalConnectedSpeech = clampScore (rawConnectedSpeech - speedPenalty)
      finalProsody = clampScore (rawProsody - speedPenalty)

      -- Overall: 6 スコアの加重平均（overall は ConnectedSpeech/Prosody/NativeLikeness を重視）
      finalOverall =
        clampScore $
          ( finalAccuracy * 20
              + finalNativeLikeness * 20
              + finalPronunciation * 20
              + finalConnectedSpeech * 20
              + finalProsody * 20
          )
            `div` 100

      jaMessage = buildJaMessage finalOverall finalConnectedSpeech finalProsody
      enMessage = buildEnMessage finalOverall finalConnectedSpeech finalProsody
   in ScoringOutput
        { scoreOverall = finalOverall,
          scoreAccuracy = finalAccuracy,
          scoreNativeLikeness = finalNativeLikeness,
          scorePronunciation = finalPronunciation,
          scoreConnectedSpeech = finalConnectedSpeech,
          scoreProsody = finalProsody,
          outputTokens = tokens,
          summaryMessageJa = jaMessage,
          summaryMessageEn = enMessage
        }

-- ---- Summary message builders ----

buildJaMessage :: Int -> Int -> Int -> Text
buildJaMessage overallScore connectedSpeechScore prosodyScore
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

-- ---- Findings generation ----

-- | 語のインデックスから FindingSeverity を決定的に選択する。
-- hash mod 8 で critical:major:minor:suggestion = 1:2:3:2 の分布を持たせる。
selectSeverity :: Int -> FindingSeverity
selectSeverity hashValue =
  case hashValue `mod` 8 of
    0 -> FindingSeverityCritical
    1 -> FindingSeverityMajor
    2 -> FindingSeverityMajor
    3 -> FindingSeverityMinor
    4 -> FindingSeverityMinor
    5 -> FindingSeverityMinor
    6 -> FindingSeveritySuggestion
    _ -> FindingSeveritySuggestion

-- | 語のインデックスから FindingCategory を決定的に選択する。
selectCategory :: Int -> FindingCategory
selectCategory hashValue =
  case hashValue `mod` 5 of
    0 -> FindingCategoryAccuracy
    1 -> FindingCategoryPronunciation
    2 -> FindingCategoryConnectedSpeech
    3 -> FindingCategoryProsody
    _ -> FindingCategoryNativeLikeness

-- | severity に応じた scoreImpact（負値、決定的）。
severityToScoreImpact :: FindingSeverity -> Double
severityToScoreImpact FindingSeverityCritical = -8.0
severityToScoreImpact FindingSeverityMajor = -5.0
severityToScoreImpact FindingSeverityMinor = -2.0
severityToScoreImpact FindingSeveritySuggestion = -0.5

-- | severity に応じた confidence（決定的）。
severityToConfidence :: FindingSeverity -> Double
severityToConfidence FindingSeverityCritical = 0.9
severityToConfidence FindingSeverityMajor = 0.8
severityToConfidence FindingSeverityMinor = 0.7
severityToConfidence FindingSeveritySuggestion = 0.6

-- | category と severity から日本語メッセージを生成する。
buildFindingMessageJa :: FindingCategory -> FindingSeverity -> Text -> Text
buildFindingMessageJa category severity wordText =
  let categoryNote = case category of
        FindingCategoryAccuracy -> "正確性"
        FindingCategoryPronunciation -> "発音"
        FindingCategoryConnectedSpeech -> "連結発話"
        FindingCategoryProsody -> "プロソディ"
        FindingCategoryNativeLikeness -> "ネイティブらしさ"
      severityNote = case severity of
        FindingSeverityCritical -> "に重大な問題があります"
        FindingSeverityMajor -> "に改善が必要です"
        FindingSeverityMinor -> "に改善の余地があります"
        FindingSeveritySuggestion -> "をより自然にできます"
   in "「" <> wordText <> "」の" <> categoryNote <> severityNote <> "。"

-- | 1 トークンから AssessmentFinding を生成する。
-- 引数: token / tokenIndex（hash シード用）/ totalTokens / durationMilliseconds
buildFinding ::
  TokenSegment ->
  Int ->
  Int ->
  Int ->
  AssessmentFinding
buildFinding token tokenIndex totalTokens durationMs =
  let hashValue = tokenHash (tokenText token) tokenIndex
      -- 選定フィルタは hashValue の下位 3 bit（`mod 8`）を使うため、
      -- severity / category は独立した上位スライスから決め、偏りを避ける。
      severity = selectSeverity (hashValue `div` 8)
      category = selectCategory (hashValue `div` 64)
      tokenCount = max 1 totalTokens
      msPerToken = durationMs `div` tokenCount
      audioStartMs = tokenIndex * msPerToken
      audioEndMs =
        if tokenIndex == tokenCount - 1
          then durationMs
          else audioStartMs + msPerToken
      evidence =
        PronunciationEvidence
          { evidenceText = Just (tokenText token),
            evidenceIpa = Nothing
          }
   in AssessmentFinding
        { findingCategory = category,
          findingSeverity = severity,
          findingTextRange =
            TextRange
              { startChar = tokenStartChar token,
                endChar = tokenEndChar token
              },
          findingAudioRange =
            Just
              AudioRange
                { startMs = audioStartMs,
                  endMs = audioEndMs
                },
          findingExpected = evidence,
          findingDetected = evidence,
          findingMessageJa = buildFindingMessageJa category severity (tokenText token),
          findingMessageEn = Nothing,
          findingScoreImpact = severityToScoreImpact severity,
          findingConfidence = severityToConfidence severity
        }

-- | sectionBodyText・durationMilliseconds・AssessmentScores から決定的に findings を生成する。
-- 乱数不使用。語のハッシュと index から severity/category を決定的に選択する。
-- 最低 1 件を保証する（本文に語が存在する限り）。
generateFindings ::
  -- | sectionBodyText
  Text ->
  -- | durationMilliseconds
  Int ->
  AssessmentScores ->
  [AssessmentFinding]
generateFindings sectionBodyText durationMs scores =
  let tokens = tokenize sectionBodyText
      tokenCount = length tokens
   in if tokenCount == 0
        then []
        else
          let
            -- 語のサブセット選定: tokenHash mod の結果が選定閾値未満の語を選ぶ。
            -- overall スコアが低いほど閾値を広げて finding を増やす。
            overallScore = overall scores
            selectionThreshold
              | overallScore < 60 = 4 -- ~50% の語を選ぶ
              | overallScore < 80 = 3 -- ~38% の語を選ぶ
              | otherwise = 2 -- ~25% の語を選ぶ
            indexed = zip [0 ..] tokens
            selectedTokens =
              filter
                (\(index, token) -> tokenHash (tokenText token) index `mod` 8 < selectionThreshold)
                indexed
            -- 最低 1 件保証: 選定がゼロなら先頭語を強制選択
            effectiveTokens =
              if null selectedTokens
                then take 1 indexed
                else selectedTokens
           in
            map
              (\(index, token) -> buildFinding token index tokenCount durationMs)
              effectiveTokens
