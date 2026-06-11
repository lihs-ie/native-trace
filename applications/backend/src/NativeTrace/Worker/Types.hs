module NativeTrace.Worker.Types (
  HealthResponse (..),
  VersionResponse (..),
  AssessmentRequest (..),
  AudioMetadata (..),
  AssessmentResponse (..),
  AssessmentScores (..),
  AssessmentSummary (..),
  AssessmentFinding (..),
  FindingCategory (..),
  FindingSeverity (..),
  AssessmentSegment (..),
  TextRange (..),
  AudioRange (..),
  PronunciationEvidence (..),
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

data AssessmentScores = AssessmentScores
  { overall :: Int,
    accuracy :: Int,
    nativeLikeness :: Int,
    pronunciation :: Int,
    connectedSpeech :: Int,
    prosody :: Int
  }

instance ToJSON AssessmentScores where
  toJSON scores =
    object
      [ "overall" .= overall scores,
        "accuracy" .= accuracy scores,
        "nativeLikeness" .= nativeLikeness scores,
        "pronunciation" .= pronunciation scores,
        "connectedSpeech" .= connectedSpeech scores,
        "prosody" .= prosody scores
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
    findingMessageJa :: Text,
    findingMessageEn :: Maybe Text,
    findingScoreImpact :: Double,
    findingConfidence :: Double
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
        "confidence" .= findingConfidence finding
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

data AssessmentResponse = AssessmentResponse
  { responseAssessmentSchemaVersion :: Text,
    responseTokenizerVersion :: Text,
    responseScores :: AssessmentScores,
    responseSummary :: AssessmentSummary,
    responseFindings :: [AssessmentFinding],
    responseSegments :: [AssessmentSegment],
    responseMetadata :: WorkerResponseMetadata
  }

instance ToJSON AssessmentResponse where
  toJSON response =
    object
      [ "assessmentSchemaVersion" .= responseAssessmentSchemaVersion response,
        "tokenizerVersion" .= responseTokenizerVersion response,
        "scores" .= responseScores response,
        "summary" .= responseSummary response,
        "findings" .= responseFindings response,
        "segments" .= responseSegments response,
        "metadata" .= responseMetadata response
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
