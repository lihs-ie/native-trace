-- | 発音解析オーケストレーション。
-- multipart リクエストの検証と解析結果の組み立てを担当する。
module NativeTrace.Worker.Assessment (
  AssessmentError (..),
  validatePronunciationRequest,
  buildAssessmentResponseFromGop,
  errorCode,
  errorMessage,
)
where

import Data.ByteString (ByteString)
import Data.ByteString qualified as ByteString
import Data.Text (Text)
import Data.Text qualified as Text
import NativeTrace.Worker.AnalyzerClient (
  AnalyzerResult (..),
  PhonemeGop (..),
 )
import NativeTrace.Worker.Scoring (
  ScoringOutput (..),
  TokenSegment (..),
  buildAssessmentScores,
  buildDynamicSummary,
  buildFocusSounds,
  buildPerPhonemeHeatmap,
  buildProsodyOutput,
  checkAudioQuality,
  generateFindingsFromGop,
  scoreFromGop,
  tokenize,
 )
import NativeTrace.Worker.Types (
  AssessmentRequest (..),
  AssessmentResponse (..),
  AssessmentScores (..),
  AssessmentSegment (..),
  AssessmentStatus (..),
  AssessmentSummary (..),
  AudioMetadata (..),
  AudioRange (..),
  CefrScore (..),
  DiagnosticPhonemeGopEntry (..),
  TextRange (..),
  WorkerResponseMetadata (..),
 )

-- ---- 定数（W12: リテラル→名前付き定数。値は不変） ----

-- | audio duration の許容下限（ミリ秒）。
audioDurationMinMs :: Int
audioDurationMinMs = 1

-- | audio duration の許容上限（ミリ秒）。
audioDurationMaxMs :: Int
audioDurationMaxMs = 600000

-- | computeConfidence の基準値。
confidenceBaseValue :: Double
confidenceBaseValue = 0.7

-- | computeConfidence の振幅。
confidenceAmplitude :: Double
confidenceAmplitude = 0.25

-- | computeConfidence の位相スケール定数。円周率の近似値だが
-- `pi` に置換してはならない（W12: 値が変わるため。定数名を付けるのみ）。
confidenceSeedApproxPi :: Double
confidenceSeedApproxPi = 3.14159

-- ---- Validation errors ----

data AssessmentError
  = EmptySectionBodyText
  | UnsupportedLanguage Text
  | UnsupportedAccent Text
  | EmptyRequestedMetrics
  | AudioDurationOutOfRange Int
  | AudioByteLengthMismatch Int Int
  | AudioMimeTypeMismatch Text Text
  deriving (Show, Eq)

-- | エラーコードを返す（§8.2 error.code 用）。
errorCode :: AssessmentError -> Text
errorCode EmptySectionBodyText = "empty_section_body_text"
errorCode (UnsupportedLanguage lang) = "unsupported_language:" <> lang
errorCode (UnsupportedAccent accent) = "unsupported_accent:" <> accent
errorCode EmptyRequestedMetrics = "empty_requested_metrics"
errorCode (AudioDurationOutOfRange duration) = "audio_duration_out_of_range:" <> Text.pack (show duration)
errorCode (AudioByteLengthMismatch _ _) = "audio_byte_length_mismatch"
errorCode (AudioMimeTypeMismatch _ _) = "audio_mime_type_mismatch"

-- | エラーメッセージを返す（§8.2 error.message 用）。
errorMessage :: AssessmentError -> Text
errorMessage EmptySectionBodyText = "sectionBodyText must not be empty."
errorMessage (UnsupportedLanguage lang) = "Unsupported expectedLanguage: " <> lang <> ". Only \"en-US\" is supported."
errorMessage (UnsupportedAccent accent) = "Unsupported targetAccent: " <> accent <> ". Only \"generalAmerican\" is supported."
errorMessage EmptyRequestedMetrics = "requestedMetrics must contain at least one metric."
errorMessage (AudioDurationOutOfRange duration) =
  "Audio duration "
    <> Text.pack (show duration)
    <> "ms is out of range ["
    <> Text.pack (show audioDurationMinMs)
    <> ", "
    <> Text.pack (show audioDurationMaxMs)
    <> "]."
errorMessage (AudioByteLengthMismatch declared actual) =
  "Declared byteLength " <> Text.pack (show declared) <> " does not match actual audio size " <> Text.pack (show actual) <> "."
errorMessage (AudioMimeTypeMismatch declared _actual) =
  "Declared mimeType " <> declared <> " does not match the Content-Type of the audio part."

-- ---- Validation ----

-- | リクエストの検証のみを行う純粋関数。
validatePronunciationRequest :: AssessmentRequest -> ByteString -> Maybe Text -> Either AssessmentError ()
validatePronunciationRequest request audioBytes audioPart = do
  -- sectionBodyText 非空
  if Text.null (sectionBodyText request)
    then Left EmptySectionBodyText
    else Right ()
  -- expectedLanguage
  if expectedLanguage request /= "en-US"
    then Left (UnsupportedLanguage (expectedLanguage request))
    else Right ()
  -- targetAccent
  if targetAccent request /= "generalAmerican"
    then Left (UnsupportedAccent (targetAccent request))
    else Right ()
  -- requestedMetrics 非空
  if null (requestedMetrics request)
    then Left EmptyRequestedMetrics
    else Right ()
  -- audio duration 範囲
  let duration = audioDurationMilliseconds (requestAudio request)
  if duration < audioDurationMinMs || duration > audioDurationMaxMs
    then Left (AudioDurationOutOfRange duration)
    else Right ()
  -- byteLength 一致
  let declaredByteLength = audioByteLength (requestAudio request)
  let actualByteLength = ByteString.length audioBytes
  if declaredByteLength /= actualByteLength
    then Left (AudioByteLengthMismatch declaredByteLength actualByteLength)
    else Right ()
  -- mimeType 一致（audio part の Content-Type が提供されている場合のみ検証）
  case audioPart of
    Nothing -> Right ()
    Just partContentType ->
      let declared = audioMimeType (requestAudio request)
          -- Content-Type は "audio/webm; codecs=opus" のようにパラメータを含む場合がある
          baseMimeType = Text.strip (Text.takeWhile (/= ';') partContentType)
       in if declared /= baseMimeType
            then Left (AudioMimeTypeMismatch declared baseMimeType)
            else Right ()

-- ---- Assembly ----

-- | AnalyzerResult から AssessmentResponse を組み立てる（純粋）。
-- handler で analyzeAudio を呼んだ後にこの関数でレスポンスを構築する。
-- meanDbfs / speechDurationSeconds が閾値未満なら low_quality として早期返却する。
buildAssessmentResponseFromGop ::
  AssessmentRequest ->
  AnalyzerResult ->
  AssessmentResponse
buildAssessmentResponseFromGop request analyzerResult =
  let durationMs = audioDurationMilliseconds (requestAudio request)
      meanDbfs = analyzedMeanDbfs analyzerResult
      estimatedSnrDb = analyzedEstimatedSnrDb analyzerResult
      detectedPhonemeCount = length (Text.words (analyzedDetectedIpa analyzerResult))
      expectedPhonemeCount = length (Text.words (analyzedExpectedIpa analyzerResult))
      gopValues = map gopValue (analyzedPerPhonemeGop analyzerResult)
   in if checkAudioQuality meanDbfs durationMs detectedPhonemeCount expectedPhonemeCount gopValues estimatedSnrDb
        then buildLowQualityResponse request analyzerResult
        else buildNormalResponse request analyzerResult

-- | 両応答（low_quality / normal）で共有する worker メタデータ。
sharedResponseMetadata :: WorkerResponseMetadata
sharedResponseMetadata =
  WorkerResponseMetadata
    { responseWorkerVersion = "0.2.0",
      responseModelVersion = "model-v2",
      responseRuleSetVersion = "rules-v2",
      responseScoringRubricVersion = "rubric-v2"
    }

-- | 両応答（low_quality / normal）で共有する diagnostic per-phoneme GOP マッピング。
buildDiagnosticEntries :: AnalyzerResult -> [DiagnosticPhonemeGopEntry]
buildDiagnosticEntries analyzerResult = map toDiagnosticEntry (analyzedPerPhonemeGop analyzerResult)

-- | low_quality 応答（M-CRL-16 / ADR-022 D17）。スコアは全ゼロ、findings / segments /
-- perPhonemeGop は空のまま、diagnosticPerPhonemeGop のみ充足する。
buildLowQualityResponse :: AssessmentRequest -> AnalyzerResult -> AssessmentResponse
buildLowQualityResponse request analyzerResult =
  AssessmentResponse
    { responseAssessmentSchemaVersion = assessmentSchemaVersion request,
      responseTokenizerVersion = tokenizerVersion request,
      responseStatus = AssessmentStatusLowQuality,
      responseScores = zeroScores,
      responseSummary = lowQualitySummary,
      responseFindings = [],
      responseSegments = [],
      responseMetadata = sharedResponseMetadata,
      responsePerPhonemeGop = [],
      responseFocusSounds = [],
      responseProsody = Nothing,
      responseDiagnosticPerPhonemeGop = buildDiagnosticEntries analyzerResult
    }
 where
  lowQualitySummary =
    AssessmentSummary
      { messageJa = "音声品質が不十分です。録音環境を改善して再度お試しください。",
        messageEn = Just "Audio quality is insufficient. Please improve your recording environment and try again."
      }
  zeroScores =
    AssessmentScores
      { overall = 0,
        accuracy = 0,
        nativeLikeness = 0,
        pronunciation = 0,
        connectedSpeech = 0,
        prosody = 0,
        intelligibility = 0,
        cefrOverall = CefrScore {cefrScoreValue = 0, cefrBand = "A2"},
        cefrSegmental = CefrScore {cefrScoreValue = 0, cefrBand = "A2"},
        cefrProsodic = CefrScore {cefrScoreValue = 0, cefrBand = "A2"}
      }

-- | 通常応答。スコアリングパイプライン（build* 7 連）で全フィールドを構築する。
buildNormalResponse :: AssessmentRequest -> AnalyzerResult -> AssessmentResponse
buildNormalResponse request analyzerResult =
  AssessmentResponse
    { responseAssessmentSchemaVersion = assessmentSchemaVersion request,
      responseTokenizerVersion = tokenizerVersion request,
      responseStatus = AssessmentStatusNormal,
      responseScores = scores,
      responseSummary = summary,
      responseFindings = findings,
      responseSegments = segments,
      responseMetadata = sharedResponseMetadata,
      responsePerPhonemeGop = heatmap,
      responseFocusSounds = focusSounds,
      responseProsody = prosodyOutput,
      responseDiagnosticPerPhonemeGop = buildDiagnosticEntries analyzerResult
    }
 where
  durationMs = audioDurationMilliseconds (requestAudio request)
  bodyText = sectionBodyText request
  scoringOutput = scoreFromGop analyzerResult (tokenize bodyText)
  segments = buildSegments request (outputTokens scoringOutput) durationMs
  findings = generateFindingsFromGop bodyText analyzerResult
  scores = buildAssessmentScores scoringOutput findings
  focusSounds = buildFocusSounds findings
  prosodyOutput = buildProsodyOutput analyzerResult
  dynamicSummaryJa = buildDynamicSummary focusSounds scoringOutput
  summary =
    AssessmentSummary
      { messageJa = dynamicSummaryJa,
        messageEn = Nothing
      }
  phonemeGops = analyzedPerPhonemeGop analyzerResult
  tokens = outputTokens scoringOutput
  tokenCount = length tokens
  heatmap = buildPerPhonemeHeatmap phonemeGops tokens tokenCount

-- | PhonemeGop から DiagnosticPhonemeGopEntry への変換。
toDiagnosticEntry :: PhonemeGop -> DiagnosticPhonemeGopEntry
toDiagnosticEntry pg =
  DiagnosticPhonemeGopEntry
    { diagPhoneme = gopPhoneme pg,
      diagGop = gopValue pg,
      diagStartMs = gopStartMs pg,
      diagEndMs = gopEndMs pg
    }

-- | トークンリストから Segment を生成する。
-- audioRange は duration を均等割り当てする。
buildSegments ::
  AssessmentRequest ->
  [TokenSegment] ->
  Int ->
  [AssessmentSegment]
buildSegments request tokens durationMs =
  let tokenCount = max 1 (length tokens)
      msPerToken = durationMs `div` tokenCount
      indexed = zip [0 ..] tokens
   in map (buildSegment tokenCount msPerToken) indexed
 where
  buildSegment tokenCount msPerToken (index, token) =
    let segStartMs = index * msPerToken
        segEndMs =
          if index == tokenCount - 1
            then durationMs
            else segStartMs + msPerToken
     in AssessmentSegment
          { segmentTextRange =
              TextRange
                { startChar = tokenStartChar token,
                  endChar = tokenEndChar token
                },
            segmentAudioRange =
              AudioRange
                { startMs = segStartMs,
                  endMs = segEndMs
                },
            segmentTranscript = Just (tokenText token),
            segmentConfidence = computeConfidence request index tokenCount
          }

-- | 決定的な confidence 値を算出する（0..1）。
computeConfidence :: AssessmentRequest -> Int -> Int -> Double
computeConfidence request tokenIndex tokenCount =
  let durationMs = audioDurationMilliseconds (requestAudio request)
      seed = fromIntegral durationMs :: Double
      position = fromIntegral tokenIndex / fromIntegral (max 1 tokenCount) :: Double
      raw = confidenceBaseValue + confidenceAmplitude * sin (seed / 1000.0 + position * confidenceSeedApproxPi)
   in max 0.0 (min 1.0 raw)
