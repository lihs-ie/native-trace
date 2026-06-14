{-# LANGUAGE ImportQualifiedPost #-}

-- | golden speaker サービスへの HTTP クライアント（M-GRV-6 / ADR-012）。
-- POST /v1/convert を呼び出し GoldenSpeakerConversionDto を返す。
-- GOLDEN_SPEAKER_URL 環境変数で接続先を変える。
-- 環境変数が未設定の場合は 503 を返し、他ルートに影響を与えない（M-GRV-9 軟無効化）。
module NativeTrace.Worker.GoldenSpeakerClient (
  convertGoldenSpeaker,
)
where

import Control.Monad.IO.Class (liftIO)
import Data.Aeson qualified as Aeson
import Data.ByteString (ByteString)
import Data.ByteString.Lazy qualified as LBS
import Data.Text (Text)
import Data.Text qualified as Text
import Data.Text.Encoding qualified as TextEncoding
import NativeTrace.Worker.Types (GoldenSpeakerConversionDto)
import Network.HTTP.Client (
  Request (..),
  RequestBody (..),
  httpLbs,
  newManager,
  parseRequest,
  responseBody,
  responseStatus,
 )
import Network.HTTP.Client.TLS (tlsManagerSettings)
import Network.HTTP.Types (status200, status500)
import Servant (Handler, ServerError (..), err502, err503, throwError)
import System.Environment (lookupEnv)

-- | GOLDEN_SPEAKER_URL を読む。
-- 未設定の場合は Nothing を返す（軟無効化判定用）。
resolveGoldenSpeakerUrl :: IO (Maybe Text)
resolveGoldenSpeakerUrl = do
  maybeUrl <- lookupEnv "GOLDEN_SPEAKER_URL"
  pure (fmap Text.pack maybeUrl)

-- | golden サービスの POST /v1/convert を呼び出し GoldenSpeakerConversionDto を返す。
-- GOLDEN_SPEAKER_URL が未設定の場合は 503 を返す（M-GRV-9 軟無効化）。
-- 5xx の場合は 502 に変換して上位に伝播する。
convertGoldenSpeaker ::
  -- | 学習者音声バイト列
  ByteString ->
  -- | 音声 MIME タイプ
  Text ->
  Handler GoldenSpeakerConversionDto
convertGoldenSpeaker learnerAudioBytes mimeType = do
  maybeBaseUrl <- liftIO resolveGoldenSpeakerUrl
  case maybeBaseUrl of
    Nothing ->
      throwError
        err503
          { errBody = "Golden speaker service is not configured. Set GOLDEN_SPEAKER_URL to enable."
          }
    Just baseUrl -> do
      let goldenUrl = Text.unpack baseUrl <> "/v1/convert"
      manager <- liftIO $ newManager tlsManagerSettings
      initialRequest <- liftIO $ parseRequest goldenUrl
      let boundary = "native-trace-golden-boundary"
      let requestBodyBytes = buildGoldenMultipartBody boundary mimeType learnerAudioBytes
      let contentTypeHeader =
            ( "Content-Type",
              "multipart/form-data; boundary=" <> TextEncoding.encodeUtf8 boundary
            )
      let httpRequest =
            initialRequest
              { method = "POST",
                requestBody = RequestBodyBS requestBodyBytes,
                requestHeaders = [contentTypeHeader]
              }
      response <- liftIO $ httpLbs httpRequest manager
      let httpStatus = responseStatus response
      if httpStatus == status200
        then case Aeson.eitherDecode (responseBody response) of
          Right result -> pure result
          Left decodeError ->
            throwError
              err502
                { errBody =
                    LBS.fromStrict $
                      TextEncoding.encodeUtf8 $
                        "golden speaker response parse error: " <> Text.pack decodeError
                }
        else
          if httpStatus >= status500
            then throwError err502 {errBody = responseBody response}
            else
              throwError
                err502
                  { errBody =
                      LBS.fromStrict $
                        TextEncoding.encodeUtf8 $
                          "unexpected golden speaker status: " <> Text.pack (show httpStatus)
                  }

-- | golden /v1/convert 用 multipart body を組み立てる。
-- golden サービスは learner_audio ファイル + metadata JSON（{ mimeType }）を受け取る。
buildGoldenMultipartBody :: Text -> Text -> ByteString -> ByteString
buildGoldenMultipartBody boundary mimeType learnerBytes =
  let sep = TextEncoding.encodeUtf8 ("--" <> boundary)
      crlf = "\r\n"
      ext = mimeTypeToExtension mimeType
      metadataJson = "{\"mimeType\":\"" <> TextEncoding.encodeUtf8 mimeType <> "\"}"
      metaPart =
        sep
          <> crlf
          <> "Content-Disposition: form-data; name=\"metadata\"\r\n"
          <> "Content-Type: application/json; charset=utf-8\r\n"
          <> crlf
          <> metadataJson
          <> crlf
      learnerPart =
        sep
          <> crlf
          <> TextEncoding.encodeUtf8 ("Content-Disposition: form-data; name=\"learner_audio\"; filename=\"learner." <> ext <> "\"\r\n")
          <> TextEncoding.encodeUtf8 ("Content-Type: " <> mimeType <> "\r\n")
          <> crlf
          <> learnerBytes
          <> crlf
      closing = sep <> "--\r\n"
   in metaPart <> learnerPart <> closing

-- | MIME タイプから拡張子を返す。未知の場合は "bin"。
mimeTypeToExtension :: Text -> Text
mimeTypeToExtension mime
  | Text.isPrefixOf "audio/wav" mime = "wav"
  | Text.isPrefixOf "audio/webm" mime = "webm"
  | Text.isPrefixOf "audio/ogg" mime = "ogg"
  | Text.isPrefixOf "audio/mpeg" mime = "mp3"
  | Text.isPrefixOf "audio/mp4" mime = "m4a"
  | Text.isPrefixOf "audio/flac" mime = "flac"
  | otherwise = "bin"
