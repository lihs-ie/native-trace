module NativeTrace.Worker.Types (
  HealthResponse (..),
  VersionResponse (..),
  AssessmentRequest (..),
  AudioMetadata (..),
  AssessmentStatus (..),
  AssessmentResponse (..),
  AssessmentScores (..),
  CefrScore (..),
  AssessmentSummary (..),
  AssessmentFinding (..),
  FindingCategory (..),
  FindingSeverity (..),
  AssessmentSegment (..),
  TextRange (..),
  AudioRange (..),
  PronunciationEvidence (..),
  WordPair (..),
  NBestOutputEntry (..),
  PhonemeHeatEntry (..),
  FocusSound (..),
  ProsodyOutput (..),
  WordStressOutput (..),
  WorkerResponseMetadata (..),
  WorkerError (..),
  WorkerErrorBody (..),
)
where

import Data.Aeson (FromJSON (..), ToJSON (..), object, withObject, (.:), (.:?), (.=))
import Data.Text (Text)

-- ---- Health / Version ----

newtype HealthResponse = HealthResponse
  { healthStatus :: Text
  }

instance ToJSON HealthResponse where
  toJSON response = object ["status" .= healthStatus response]

data VersionResponse = VersionResponse
  { workerVersion :: Text,
    modelVersion :: Maybe Text,
    ruleSetVersion :: Maybe Text
  }

instance ToJSON VersionResponse where
  toJSON response =
    object
      [ "workerVersion" .= workerVersion response,
        "modelVersion" .= modelVersion response,
        "ruleSetVersion" .= ruleSetVersion response
      ]

-- ---- Assessment Request (metadata part) ----

data AudioMetadata = AudioMetadata
  { audioMimeType :: Text,
    audioByteLength :: Int,
    audioDurationMilliseconds :: Int
  }

instance FromJSON AudioMetadata where
  parseJSON = withObject "AudioMetadata" $ \object -> do
    mimeType <- object .: "mimeType"
    byteLength <- object .: "byteLength"
    durationMs <- object .: "durationMilliseconds"
    pure
      AudioMetadata
        { audioMimeType = mimeType,
          audioByteLength = byteLength,
          audioDurationMilliseconds = durationMs
        }

data AssessmentRequest = AssessmentRequest
  { analysisJob :: Text,
    analysisRun :: Text,
    recordingAttempt :: Text,
    requestSection :: Text,
    sectionBodyText :: Text,
    expectedLanguage :: Text,
    targetAccent :: Text,
    requestedMetrics :: [Text],
    assessmentSchemaVersion :: Text,
    tokenizerVersion :: Text,
    requestAudio :: AudioMetadata
  }

instance FromJSON AssessmentRequest where
  parseJSON = withObject "AssessmentRequest" $ \object -> do
    job <- object .: "analysisJob"
    run <- object .: "analysisRun"
    attempt <- object .: "recordingAttempt"
    section <- object .: "section"
    bodyText <- object .: "sectionBodyText"
    language <- object .: "expectedLanguage"
    accent <- object .: "targetAccent"
    metrics <- object .: "requestedMetrics"
    schemaVersion <- object .: "assessmentSchemaVersion"
    tokVersion <- object .: "tokenizerVersion"
    audioMeta <- object .: "audio"
    pure
      AssessmentRequest
        { analysisJob = job,
          analysisRun = run,
          recordingAttempt = attempt,
          requestSection = section,
          sectionBodyText = bodyText,
          expectedLanguage = language,
          targetAccent = accent,
          requestedMetrics = metrics,
          assessmentSchemaVersion = schemaVersion,
          tokenizerVersion = tokVersion,
          requestAudio = audioMeta
        }

-- ---- Assessment Response ----

-- | CEFR スコアと帯域（C3-b）。
data CefrScore = CefrScore
  { cefrScoreValue :: Int,
    cefrBand :: Text
  }

instance ToJSON CefrScore where
  toJSON cs =
    object
      [ "score" .= cefrScoreValue cs,
        "band" .= cefrBand cs
      ]

data AssessmentScores = AssessmentScores
  { overall :: Int,
    accuracy :: Int,
    nativeLikeness :: Int,
    pronunciation :: Int,
    connectedSpeech :: Int,
    prosody :: Int,
    -- | FL 重み付き明瞭性スコア（C3-b）。
    intelligibility :: Int,
    -- | CEFR 全体的音韻統制（C3-b）。
    cefrOverall :: CefrScore,
    -- | CEFR 分節（C3-b）。
    cefrSegmental :: CefrScore,
    -- | CEFR 韻律（C3-b）。
    cefrProsodic :: CefrScore
  }

instance ToJSON AssessmentScores where
  toJSON scores =
    object
      [ "overall" .= overall scores,
        "accuracy" .= accuracy scores,
        "nativeLikeness" .= nativeLikeness scores,
        "pronunciation" .= pronunciation scores,
        "connectedSpeech" .= connectedSpeech scores,
        "prosody" .= prosody scores,
        "intelligibility" .= intelligibility scores,
        "cefrOverall" .= cefrOverall scores,
        "cefrSegmental" .= cefrSegmental scores,
        "cefrProsodic" .= cefrProsodic scores
      ]

data AssessmentSummary = AssessmentSummary
  { messageJa :: Text,
    messageEn :: Maybe Text
  }

instance ToJSON AssessmentSummary where
  toJSON summary =
    object
      [ "messageJa" .= messageJa summary,
        "messageEn" .= messageEn summary
      ]

data TextRange = TextRange
  { startChar :: Int,
    endChar :: Int
  }

instance ToJSON TextRange where
  toJSON range =
    object
      [ "startChar" .= startChar range,
        "endChar" .= endChar range
      ]

data AudioRange = AudioRange
  { startMs :: Int,
    endMs :: Int
  }

instance ToJSON AudioRange where
  toJSON range =
    object
      [ "startMs" .= startMs range,
        "endMs" .= endMs range
      ]

data PronunciationEvidence = PronunciationEvidence
  { evidenceText :: Maybe Text,
    evidenceIpa :: Maybe Text
  }

instance ToJSON PronunciationEvidence where
  toJSON evidence =
    object
      [ "text" .= evidenceText evidence,
        "ipa" .= evidenceIpa evidence
      ]

-- | Connected speech 対象語ペア（C3-a）。
data WordPair = WordPair
  { wordPairFirst :: Text,
    wordPairSecond :: Text
  }

instance ToJSON WordPair where
  toJSON wp =
    object
      [ "first" .= wordPairFirst wp,
        "second" .= wordPairSecond wp
      ]

-- | NBest 出力エントリ（C3-a）。
data NBestOutputEntry = NBestOutputEntry
  { nBestOutputPhoneme :: Text,
    nBestOutputConfidence :: Double
  }

instance ToJSON NBestOutputEntry where
  toJSON e =
    object
      [ "phoneme" .= nBestOutputPhoneme e,
        "confidence" .= nBestOutputConfidence e
      ]

data FindingCategory
  = FindingCategoryAccuracy
  | FindingCategoryPronunciation
  | FindingCategoryConnectedSpeech
  | FindingCategoryProsody
  | FindingCategoryNativeLikeness

instance ToJSON FindingCategory where
  toJSON FindingCategoryAccuracy = "accuracy"
  toJSON FindingCategoryPronunciation = "pronunciation"
  toJSON FindingCategoryConnectedSpeech = "connectedSpeech"
  toJSON FindingCategoryProsody = "prosody"
  toJSON FindingCategoryNativeLikeness = "nativeLikeness"

data FindingSeverity
  = FindingSeverityCritical
  | FindingSeverityMajor
  | FindingSeverityMinor
  | FindingSeveritySuggestion

instance ToJSON FindingSeverity where
  toJSON FindingSeverityCritical = "critical"
  toJSON FindingSeverityMajor = "major"
  toJSON FindingSeverityMinor = "minor"
  toJSON FindingSeveritySuggestion = "suggestion"

data AssessmentFinding = AssessmentFinding
  { findingCategory :: FindingCategory,
    findingSeverity :: FindingSeverity,
    findingTextRange :: TextRange,
    findingAudioRange :: Maybe AudioRange,
    findingExpected :: PronunciationEvidence,
    findingDetected :: PronunciationEvidence,
    -- | 日本語改善メッセージ。ADR-004: worker では生成しないため常に Nothing。
    findingMessageJa :: Maybe Text,
    findingMessageEn :: Maybe Text,
    findingScoreImpact :: Double,
    findingConfidence :: Double,
    -- | 発音現象の種別（11値: substitution/omission/insertion/connectedSpeech/
    -- weakForm/linking/flap/assimilation/reduction/epenthesis/lexicalStress）。
    findingPhenomenon :: Text,
    -- | GOP 値（Goodness of Pronunciation）。null 許容。
    findingGop :: Maybe Double,
    -- | NBest 最有力候補 IPA（C3-a, M-103）。
    findingDetectedTopCandidate :: Maybe Text,
    -- | NBest 上位3候補（C3-a, M-103）。
    findingNBest :: Maybe [NBestOutputEntry],
    -- | 混同セット一致フラグ（C3-a, M-103）。
    findingMatchesL1Pattern :: Bool,
    -- | Functional Load ランク（C3-a, M-112）。
    findingFunctionalLoad :: Maybe Text,
    -- | カタログ ID（C3-a, M-101）。
    findingCatalogId :: Maybe Text,
    -- | Connected speech 対象語ペア（C3-a, M-109）。
    findingWordPair :: Maybe WordPair,
    -- | Connected speech 期待発音 IPA（C3-a, M-109）。
    findingExpectedPronunciation :: Maybe Text,
    -- | Epenthesis 挿入母音 IPA（C3-a, M-115）。
    findingInsertedVowel :: Maybe Text,
    -- | Epenthesis 挿入位置 ms（C3-a, M-115）。
    findingInsertionPositionMs :: Maybe Int,
    -- | 音素の単語内位置ラベル（M-104R）。値は "initial" | "medial" | "final" | null。
    findingWordPositionLabel :: Maybe Text
  }

instance ToJSON AssessmentFinding where
  toJSON finding =
    object
      [ "category" .= findingCategory finding,
        "severity" .= findingSeverity finding,
        "textRange" .= findingTextRange finding,
        "audioRange" .= findingAudioRange finding,
        "expected" .= findingExpected finding,
        "detected" .= findingDetected finding,
        "messageJa" .= findingMessageJa finding,
        "messageEn" .= findingMessageEn finding,
        "scoreImpact" .= findingScoreImpact finding,
        "confidence" .= findingConfidence finding,
        "phenomenon" .= findingPhenomenon finding,
        "gop" .= findingGop finding,
        "detectedTopCandidate" .= findingDetectedTopCandidate finding,
        "nBest" .= findingNBest finding,
        "matchesL1Pattern" .= findingMatchesL1Pattern finding,
        "functionalLoad" .= findingFunctionalLoad finding,
        "catalogId" .= findingCatalogId finding,
        "wordPair" .= findingWordPair finding,
        "expectedPronunciation" .= findingExpectedPronunciation finding,
        "insertedVowel" .= findingInsertedVowel finding,
        "insertionPositionMs" .= findingInsertionPositionMs finding,
        "wordPositionLabel" .= findingWordPositionLabel finding
      ]

-- | 全音素 GOP ヒートマップエントリ（C3-c, M-107c）。
data PhonemeHeatEntry = PhonemeHeatEntry
  { heatWord :: Text,
    heatPhoneme :: Text,
    heatGop :: Double,
    -- | ヒートレベル: 0（良好）〜4（最悪）。
    heatLevel :: Int
  }

instance ToJSON PhonemeHeatEntry where
  toJSON e =
    object
      [ "word" .= heatWord e,
        "phoneme" .= heatPhoneme e,
        "gop" .= heatGop e,
        "heat" .= heatLevel e
      ]

-- | Focus sound エントリ（C3-c, M-112）。
data FocusSound = FocusSound
  { focusPair :: Text,
    focusPhenomenon :: Maybe Text,
    focusFunctionalLoad :: Text,
    focusOccurrences :: Int,
    focusPriority :: Text,
    focusReasonJa :: Text,
    focusCatalogId :: Maybe Text
  }

instance ToJSON FocusSound where
  toJSON fs =
    object
      [ "pair" .= focusPair fs,
        "phenomenon" .= focusPhenomenon fs,
        "functionalLoad" .= focusFunctionalLoad fs,
        "occurrences" .= focusOccurrences fs,
        "priority" .= focusPriority fs,
        "reasonJa" .= focusReasonJa fs,
        "catalogId" .= focusCatalogId fs
      ]

-- | 語強勢出力エントリ（C3-c prosody 内）。
data WordStressOutput = WordStressOutput
  { wordStressOutputWord :: Text,
    wordStressOutputWordIndex :: Int,
    wordStressOutputExpected :: Int,
    wordStressOutputPredicted :: Int
  }

instance ToJSON WordStressOutput where
  toJSON ws =
    object
      [ "word" .= wordStressOutputWord ws,
        "wordIndex" .= wordStressOutputWordIndex ws,
        "expectedStress" .= wordStressOutputExpected ws,
        "predictedStress" .= wordStressOutputPredicted ws
      ]

-- | 韻律生データ出力（C3-c, M-114）。
data ProsodyOutput = ProsodyOutput
  { prosodyF0TimesMs :: [Int],
    prosodyF0ValuesHz :: [Double],
    -- | お手本 F0 輪郭の時刻列（M-F0REF-b）。空なら reference 未生成（JSON は null）。
    prosodyReferenceF0TimesMs :: [Int],
    -- | お手本 F0 輪郭の基本周波数列（M-F0REF-b）。
    prosodyReferenceF0ValuesHz :: [Double],
    prosodyWordStress :: [WordStressOutput],
    prosodyRhythmNpvi :: Double,
    prosodyReferenceNpvi :: Double,
    -- | 弱形実現率（0-1）。
    prosodyWeakFormRate :: Double
  }

instance ToJSON ProsodyOutput where
  toJSON po =
    object
      [ "f0Contour"
          .= object
            [ "timesMs" .= prosodyF0TimesMs po,
              "valuesHz" .= prosodyF0ValuesHz po
            ],
        "referenceF0Contour"
          .= if null (prosodyReferenceF0TimesMs po)
            then Nothing
            else
              Just
                ( object
                    [ "timesMs" .= prosodyReferenceF0TimesMs po,
                      "valuesHz" .= prosodyReferenceF0ValuesHz po
                    ]
                ),
        "wordStress" .= prosodyWordStress po,
        "rhythmNpvi" .= prosodyRhythmNpvi po,
        "referenceNpvi" .= prosodyReferenceNpvi po,
        "weakFormRate" .= prosodyWeakFormRate po
      ]

data AssessmentSegment = AssessmentSegment
  { segmentTextRange :: TextRange,
    segmentAudioRange :: AudioRange,
    segmentTranscript :: Maybe Text,
    segmentConfidence :: Double
  }

instance ToJSON AssessmentSegment where
  toJSON segment =
    object
      [ "textRange" .= segmentTextRange segment,
        "audioRange" .= segmentAudioRange segment,
        "transcript" .= segmentTranscript segment,
        "confidence" .= segmentConfidence segment
      ]

data WorkerResponseMetadata = WorkerResponseMetadata
  { responseWorkerVersion :: Text,
    responseModelVersion :: Text,
    responseRuleSetVersion :: Text,
    responseScoringRubricVersion :: Text
  }

instance ToJSON WorkerResponseMetadata where
  toJSON meta =
    object
      [ "workerVersion" .= responseWorkerVersion meta,
        "modelVersion" .= responseModelVersion meta,
        "ruleSetVersion" .= responseRuleSetVersion meta,
        "scoringRubricVersion" .= responseScoringRubricVersion meta
      ]

-- | 採点ステータス。low_quality は音声品質不足で採点せず早期返却したことを示す。
data AssessmentStatus
  = AssessmentStatusNormal
  | AssessmentStatusLowQuality
  deriving (Show, Eq)

instance ToJSON AssessmentStatus where
  toJSON AssessmentStatusNormal = "normal"
  toJSON AssessmentStatusLowQuality = "low_quality"

data AssessmentResponse = AssessmentResponse
  { responseAssessmentSchemaVersion :: Text,
    responseTokenizerVersion :: Text,
    responseStatus :: AssessmentStatus,
    responseScores :: AssessmentScores,
    responseSummary :: AssessmentSummary,
    responseFindings :: [AssessmentFinding],
    responseSegments :: [AssessmentSegment],
    responseMetadata :: WorkerResponseMetadata,
    -- | 全音素 GOP ヒートマップ系列（C3-c, M-107c）。
    responsePerPhonemeGop :: [PhonemeHeatEntry],
    -- | Focus sounds リスト（C3-c, M-112）。
    responseFocusSounds :: [FocusSound],
    -- | 韻律生データ（C3-c, M-114）。Nothing の場合は analyzer が未対応。
    responseProsody :: Maybe ProsodyOutput
  }

instance ToJSON AssessmentResponse where
  toJSON response =
    object
      [ "assessmentSchemaVersion" .= responseAssessmentSchemaVersion response,
        "tokenizerVersion" .= responseTokenizerVersion response,
        "status" .= responseStatus response,
        "scores" .= responseScores response,
        "summary" .= responseSummary response,
        "findings" .= responseFindings response,
        "segments" .= responseSegments response,
        "metadata" .= responseMetadata response,
        "perPhonemeGop" .= responsePerPhonemeGop response,
        "focusSounds" .= responseFocusSounds response,
        "prosody" .= responseProsody response
      ]

-- ---- Error Response ----

data WorkerErrorBody = WorkerErrorBody
  { errorCode :: Text,
    errorMessage :: Text,
    errorRetryable :: Bool
  }

instance ToJSON WorkerErrorBody where
  toJSON body =
    object
      [ "code" .= errorCode body,
        "message" .= errorMessage body,
        "retryable" .= errorRetryable body
      ]

newtype WorkerError = WorkerError
  { workerError :: WorkerErrorBody
  }

instance ToJSON WorkerError where
  toJSON err = object ["error" .= workerError err]
