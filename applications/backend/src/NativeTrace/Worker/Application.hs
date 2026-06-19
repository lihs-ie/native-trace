module NativeTrace.Worker.Application (
  application,
)
where

import Control.Monad.IO.Class (liftIO)
import Data.Aeson (FromJSON (..), eitherDecodeStrict, encode, withObject, (.:))
import Data.ByteString (ByteString)
import Data.ByteString.Lazy qualified as LBS
import Data.Maybe (fromMaybe)
import Data.Text (Text)
import Data.Text qualified as Text
import Data.Text.Encoding (encodeUtf8)
import NativeTrace.Worker.AnalyzerClient (AnalyzerShadowingLagResult (..), analyzeAudio, analyzeShadowingLag)
import NativeTrace.Worker.Api (WorkerApi, workerApi)
import NativeTrace.Worker.Assessment (
  AssessmentError,
  buildAssessmentResponseFromGop,
  validatePronunciationRequest,
 )
import NativeTrace.Worker.Assessment qualified as Assessment
import NativeTrace.Worker.GoldenSpeakerClient (convertGoldenSpeaker)
import NativeTrace.Worker.Scoring (classifyGopDelta)
import NativeTrace.Worker.Types (
  AssessmentRequest (..),
  AssessmentResponse,
  AudioMetadata (..),
  GoldenSpeakerConversionDto,
  GopDeltaRequest (..),
  GopDeltaResponse,
  HealthResponse (..),
  ShadowingLagDto (..),
  VersionResponse (..),
  WorkerError (..),
  WorkerErrorBody (..),
 )
import Network.HTTP.Types (hContentType)
import Network.Wai (Application)
import Servant (
  Handler,
  Server,
  ServerError (..),
  err400,
  err502,
  serve,
  throwError,
  (:<|>) (..),
 )
import Servant.Multipart (FileData (..), Mem, MultipartData (..), lookupFile, lookupInput)
import System.Environment (lookupEnv)
import Text.Read (readMaybe)

application :: Application
application = serve workerApi server

server :: Server WorkerApi
server = health :<|> version :<|> assessPronunciation :<|> shadowingLag :<|> goldenSpeakerConvert :<|> gopDeltaClassify

health :: Handler HealthResponse
health = pure (HealthResponse "ok")

version :: Handler VersionResponse
version =
  pure
    VersionResponse
      { workerVersion = "0.1.0",
        modelVersion = Nothing,
        ruleSetVersion = Nothing
      }

assessPronunciation :: MultipartData Mem -> Handler AssessmentResponse
assessPronunciation multipart = do
  metadataBytes <- lookupMetadataBytes multipart
  request <- parseMetadata metadataBytes
  (audioBytes, audioContentType) <- lookupAudioBytes multipart
  case validatePronunciationRequest request audioBytes (Just audioContentType) of
    Left err -> throwError (toServantError err)
    Right () -> do
      -- python-analyzer に音声を送って GOP 計測値を取得する（失敗時は throwError で 502）
      let audio = requestAudio request
      analyzerResult <-
        analyzeAudio
          audioBytes
          audioContentType
          (sectionBodyText request)
          (targetAccent request)
          (audioDurationMilliseconds audio)
      pure (buildAssessmentResponseFromGop request analyzerResult)

-- | シャドーイング ラグ計測（M-SHL-3 / ADR-013）。reference_audio + learner_audio を
-- analyzer の /v1/shadowing-lag に渡し、閾値判定（recommendSlowPlayback）を付与して返す。
shadowingLag :: MultipartData Mem -> Handler ShadowingLagDto
shadowingLag multipart = do
  metadataBytes <- lookupMetadataBytes multipart
  meta <- parseShadowingMeta metadataBytes
  referenceAudio <- lookupNamedFile "reference_audio" multipart
  learnerAudio <- lookupNamedFile "learner_audio" multipart
  result <-
    analyzeShadowingLag
      referenceAudio
      learnerAudio
      (shadowingMetaMimeType meta)
      (shadowingMetaReferenceText meta)
      (shadowingMetaDurationMs meta)
  threshold <- liftIO readShadowingThresholdMs
  pure (buildShadowingLagDto result threshold)

-- | GOP delta 分類（M-CRL-7 / ADR-022）。originalGop と retryGop を受け取り
-- gopDelta / deltaSignal / boundarySignal を返す。分類ロジックは Scoring.hs の純粋関数に委譲。
gopDeltaClassify :: GopDeltaRequest -> Handler GopDeltaResponse
gopDeltaClassify request =
  pure
    ( classifyGopDelta
        (gopDeltaRequestOriginalGop request)
        (gopDeltaRequestRetryGop request)
    )

-- | golden speaker 音色変換（M-GRV-6 / ADR-012）。learner_audio を golden サービスへ渡し
-- 変換結果（or 品質ゲート withhold）を返す。GOLDEN_SPEAKER_URL 未設定時は 503（M-GRV-9 軟無効化）。
goldenSpeakerConvert :: MultipartData Mem -> Handler GoldenSpeakerConversionDto
goldenSpeakerConvert multipart =
  case lookupFile "learner_audio" multipart of
    Right fileData ->
      convertGoldenSpeaker
        (LBS.toStrict (fdPayload fileData))
        (fdFileCType fileData)
    Left _ ->
      throwError
        (badRequest "missing_audio_part" "The 'learner_audio' part is required.")

-- | shadowing-lag リクエストの metadata（referenceText / mimeType / durationMilliseconds）。
data ShadowingMeta = ShadowingMeta
  { shadowingMetaReferenceText :: Text,
    shadowingMetaMimeType :: Text,
    shadowingMetaDurationMs :: Int
  }

instance FromJSON ShadowingMeta where
  parseJSON = withObject "ShadowingMeta" $ \object ->
    ShadowingMeta
      <$> object .: "referenceText"
      <*> object .: "mimeType"
      <*> object .: "durationMilliseconds"

parseShadowingMeta :: ByteString -> Handler ShadowingMeta
parseShadowingMeta bytes =
  case eitherDecodeStrict bytes of
    Right meta -> pure meta
    Left decodeError ->
      throwError
        ( badRequest
            "invalid_metadata_json"
            ("Failed to parse metadata JSON: " <> Text.pack decodeError)
        )

lookupNamedFile :: Text -> MultipartData Mem -> Handler ByteString
lookupNamedFile name multipart =
  case lookupFile name multipart of
    Right fileData -> pure (LBS.toStrict (fdPayload fileData))
    Left _ ->
      throwError
        (badRequest "missing_audio_part" ("The '" <> name <> "' part is required."))

-- | SHADOWING_LAG_THRESHOLD_MS 環境変数（既定 500ms, M-SHL-6）を読む。domain literal を埋め込まない。
readShadowingThresholdMs :: IO Int
readShadowingThresholdMs = do
  raw <- lookupEnv "SHADOWING_LAG_THRESHOLD_MS"
  pure (maybe 500 (fromMaybe 500 . readMaybe) raw)

buildShadowingLagDto :: AnalyzerShadowingLagResult -> Int -> ShadowingLagDto
buildShadowingLagDto result threshold =
  ShadowingLagDto
    { shadowingLagMilliseconds = analyzerLagMilliseconds result,
      shadowingPerSegmentLag = analyzerPerSegmentLag result,
      shadowingSpeechRateRatio = analyzerSpeechRateRatio result,
      shadowingPauseCountLearner = analyzerPauseCountLearner result,
      shadowingPauseCountReference = analyzerPauseCountReference result,
      shadowingRecommendSlowPlayback =
        analyzerLagMilliseconds result > fromIntegral threshold,
      shadowingThresholdMilliseconds = threshold
    }

lookupMetadataBytes :: MultipartData Mem -> Handler ByteString
lookupMetadataBytes multipart =
  case lookupFile "metadata" multipart of
    Right fileData -> pure (LBS.toStrict (fdPayload fileData))
    Left _ ->
      case lookupInput "metadata" multipart of
        Right textValue -> pure (encodeUtf8 textValue)
        Left _ ->
          throwError (badRequest "missing_metadata_part" "The 'metadata' part is required.")

lookupAudioBytes :: MultipartData Mem -> Handler (ByteString, Text)
lookupAudioBytes multipart =
  case lookupFile "audio" multipart of
    Right fileData ->
      pure (LBS.toStrict (fdPayload fileData), fdFileCType fileData)
    Left _ ->
      throwError (badRequest "missing_audio_part" "The 'audio' part is required.")

parseMetadata :: ByteString -> Handler AssessmentRequest
parseMetadata bytes =
  case eitherDecodeStrict bytes of
    Right request -> pure request
    Left decodeError ->
      throwError
        ( badRequest
            "invalid_metadata_json"
            ("Failed to parse metadata JSON: " <> Text.pack decodeError)
        )

toServantError :: AssessmentError -> ServerError
toServantError err =
  let code = Assessment.errorCode err
      message = Assessment.errorMessage err
      body =
        WorkerError
          { workerError =
              WorkerErrorBody
                { errorCode = code,
                  errorMessage = message,
                  errorRetryable = False
                }
          }
   in err400
        { errBody = encode body,
          errHeaders = [(hContentType, "application/json; charset=utf-8")]
        }

-- | analyzer エラー（ServerError）を 502 として上位に伝播する。
-- analyzeAudio は既に ServerError を返すので、ここでは型合わせのみ行う。
analyzerErrorToServant :: ServerError -> ServerError
analyzerErrorToServant _ = err502

badRequest :: Text -> Text -> ServerError
badRequest code message =
  let body =
        WorkerError
          { workerError =
              WorkerErrorBody
                { errorCode = code,
                  errorMessage = message,
                  errorRetryable = False
                }
          }
   in err400
        { errBody = encode body,
          errHeaders = [(hContentType, "application/json; charset=utf-8")]
        }
