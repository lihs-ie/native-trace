module NativeTrace.Worker.Application (
  application,
)
where

import Data.Aeson (eitherDecodeStrict, encode)
import Data.ByteString (ByteString)
import Data.ByteString.Lazy qualified as LBS
import Data.Text (Text)
import Data.Text qualified as Text
import Data.Text.Encoding (encodeUtf8)
import NativeTrace.Worker.Api (WorkerApi, workerApi)
import NativeTrace.Worker.Assessment (AssessmentError, assessPronunciationRequest)
import NativeTrace.Worker.Assessment qualified as Assessment
import NativeTrace.Worker.Types (
  AssessmentRequest,
  AssessmentResponse,
  HealthResponse (..),
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
  serve,
  throwError,
  (:<|>) (..),
 )
import Servant.Multipart (FileData (..), Mem, MultipartData (..), lookupFile, lookupInput)

application :: Application
application = serve workerApi server

server :: Server WorkerApi
server = health :<|> version :<|> assessPronunciation

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
  case assessPronunciationRequest request audioBytes (Just audioContentType) of
    Left err -> throwError (toServantError err)
    Right response -> pure response

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
