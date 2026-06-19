{-# LANGUAGE ImportQualifiedPost #-}

-- | Articulatory Acoustic Inversion (AAI) サービスへの HTTP クライアント（M-AAI-8 / ADR-019）。
-- POST /v1/articulatory-inversion を呼び出し per-phoneme EMA 座標を返す。
-- AAI_URL 環境変数で接続先を変える。
-- 環境変数が未設定／HTTP 非 200／タイムアウト／デコードエラー時は Nothing を返す（軟無効化）。
-- GoldenSpeakerClient と異なり throwError しない — AAI 失敗は assessment 全体を失敗させない（M-AAI-8 soft-disable）。
module NativeTrace.Worker.AaiClient (
  RawArticulatoryEstimate (..),
  callAai,
)
where

import Control.Exception (SomeException, try)
import Control.Monad.IO.Class (liftIO)
import Data.Aeson (FromJSON (..), object, withObject, (.:), (.=))
import Data.Aeson qualified as Aeson
import Data.ByteString (ByteString)
import Data.ByteString.Lazy qualified as LBS
import Data.Text (Text)
import Data.Text qualified as Text
import Data.Text.Encoding qualified as TextEncoding
import NativeTrace.Worker.AnalyzerClient (PhonemeGop (..))
import Network.HTTP.Client (
  Request (..),
  RequestBody (..),
  httpLbs,
  newManager,
  parseRequest,
  responseBody,
  responseStatus,
  responseTimeoutMicro,
 )
import Network.HTTP.Client.TLS (tlsManagerSettings)
import Network.HTTP.Types (status200)
import Servant (Handler)
import System.Environment (lookupEnv)
import Text.Read (readMaybe)

-- | AAI_URL 環境変数を読む。未設定の場合は Nothing（軟無効化判定用）。
resolveAaiUrl :: IO (Maybe Text)
resolveAaiUrl = do
  maybeUrl <- lookupEnv "AAI_URL"
  pure (fmap Text.pack maybeUrl)

-- | AAI_TIMEOUT_SECONDS 環境変数を読む。未設定/不正時は 120 秒を返す。
-- AAI 推論（EMA 座標計算）は CPU 推論で容易に 30s を超えるため、
-- http-client の default 30s に依存せず明示する（incident 2026-06-14-worker-http-client-default-30s-timeout）。
resolveAaiTimeoutSeconds :: IO Int
resolveAaiTimeoutSeconds = do
  maybeRaw <- lookupEnv "AAI_TIMEOUT_SECONDS"
  pure $ case maybeRaw >>= readMaybe of
    Just n | n > 0 -> n
    _ -> 120

-- | AAI サービスの per-phoneme EMA 座標レスポンス（ワイヤー型）。
-- 6 座標は発話内 z-score 正規化 → [-1,1] クランプ済み（D3-b）。
data RawArticulatoryEstimate = RawArticulatoryEstimate
  { raePhoneme :: Text,
    raeStartMs :: Int,
    raeEndMs :: Int,
    raeTongueTipX :: Double,
    raeTongueTipY :: Double,
    raeTongueDorsumX :: Double,
    raeTongueDorsumY :: Double,
    raeLipApertureX :: Double,
    raeLipApertureY :: Double,
    raeDisplayEligibility :: Double
  }
  deriving (Show, Eq)

instance FromJSON RawArticulatoryEstimate where
  parseJSON = withObject "RawArticulatoryEstimate" $ \o ->
    RawArticulatoryEstimate
      <$> o .: "phoneme"
      <*> o .: "startMs"
      <*> o .: "endMs"
      <*> o .: "tongueTipX"
      <*> o .: "tongueTipY"
      <*> o .: "tongueDorsumX"
      <*> o .: "tongueDorsumY"
      <*> o .: "lipApertureX"
      <*> o .: "lipApertureY"
      <*> o .: "displayEligibility"

-- | AAI サービスのレスポンス包装型 { "perPhoneme": [...] }。
newtype AaiResponse = AaiResponse
  { aaiResponsePerPhoneme :: [RawArticulatoryEstimate]
  }

instance FromJSON AaiResponse where
  parseJSON = withObject "AaiResponse" $ \o ->
    AaiResponse <$> o .: "perPhoneme"

-- | AAI サービスの POST /v1/articulatory-inversion を呼び出す。
-- AAI_URL 未設定、HTTP 非 200、タイムアウト、デコードエラーのいずれでも Nothing を返す。
-- throwError しない（AAI 失敗は assessment 全体を失敗させない / M-AAI-8 soft-disable）。
callAai ::
  -- | 学習者音声バイト列
  ByteString ->
  -- | 音声 MIME タイプ
  Text ->
  -- | per-phoneme 境界リスト（gopPhoneme / gopStartMs / gopEndMs を使用）
  [PhonemeGop] ->
  Handler (Maybe [RawArticulatoryEstimate])
callAai learnerAudioBytes mimeType phonemeGops = do
  maybeBaseUrl <- liftIO resolveAaiUrl
  case maybeBaseUrl of
    Nothing -> pure Nothing
    Just baseUrl -> do
      timeoutSeconds <- liftIO resolveAaiTimeoutSeconds
      let aaiUrl = Text.unpack baseUrl <> "/v1/articulatory-inversion"
      result <- liftIO $ try (invokeAai aaiUrl timeoutSeconds learnerAudioBytes mimeType phonemeGops)
      case (result :: Either SomeException (Maybe [RawArticulatoryEstimate])) of
        Left _ -> pure Nothing
        Right maybeEstimates -> pure maybeEstimates

-- | HTTP リクエスト実行（IO 層に閉じ込め、例外を呼び出し元でキャッチ）。
invokeAai ::
  String ->
  Int ->
  ByteString ->
  Text ->
  [PhonemeGop] ->
  IO (Maybe [RawArticulatoryEstimate])
invokeAai aaiUrl timeoutSeconds learnerAudioBytes mimeType phonemeGops = do
  manager <- newManager tlsManagerSettings
  initialRequest <- parseRequest aaiUrl
  let boundary = "native-trace-aai-boundary"
  let requestBodyBytes = buildAaiMultipartBody boundary mimeType learnerAudioBytes phonemeGops
  let contentTypeHeader =
        ( "Content-Type",
          "multipart/form-data; boundary=" <> TextEncoding.encodeUtf8 boundary
        )
  let httpRequest =
        initialRequest
          { method = "POST",
            requestBody = RequestBodyBS requestBodyBytes,
            requestHeaders = [contentTypeHeader],
            responseTimeout = responseTimeoutMicro (timeoutSeconds * 1000000)
          }
  response <- httpLbs httpRequest manager
  let httpStatus = responseStatus response
  if httpStatus == status200
    then case Aeson.eitherDecode (responseBody response) of
      Right (AaiResponse estimates) -> pure (Just estimates)
      Left _ -> pure Nothing
    else pure Nothing

-- | AAI /v1/articulatory-inversion 用 multipart body を組み立てる。
-- learner_audio ファイルパート + metadata JSON パート（mimeType / sampleRate / boundaries）。
buildAaiMultipartBody :: Text -> Text -> ByteString -> [PhonemeGop] -> ByteString
buildAaiMultipartBody boundary mimeType learnerBytes phonemeGops =
  let sep = TextEncoding.encodeUtf8 ("--" <> boundary)
      crlf = "\r\n"
      ext = mimeTypeToExtension mimeType
      boundaries = map toBoundaryEntry phonemeGops
      metadataValue =
        LBS.toStrict $
          Aeson.encode $
            object
              [ "mimeType" .= mimeType,
                "sampleRate" .= (16000 :: Int),
                "boundaries" .= boundaries
              ]
      metaPart =
        sep
          <> crlf
          <> "Content-Disposition: form-data; name=\"metadata\"\r\n"
          <> "Content-Type: application/json; charset=utf-8\r\n"
          <> crlf
          <> metadataValue
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

-- | PhonemeGop から AAI metadata 境界エントリ JSON オブジェクトへ変換。
toBoundaryEntry :: PhonemeGop -> Aeson.Value
toBoundaryEntry phonemeGop =
  object
    [ "phoneme" .= gopPhoneme phonemeGop,
      "startMs" .= gopStartMs phonemeGop,
      "endMs" .= gopEndMs phonemeGop
    ]

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
