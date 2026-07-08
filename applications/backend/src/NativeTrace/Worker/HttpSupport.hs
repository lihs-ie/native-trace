-- | Worker の外部サービス HTTP クライアント（AnalyzerClient / AaiClient / GoldenSpeakerClient）が
-- 共有する純粋 / IO ヘルパー（W37）。
-- mime タイプ → 拡張子変換、multipart/form-data ボディ組み立て、timeout env 解決の 3 つを持つ。
-- HTTP 呼び出し本体（newManager / httpLbs / status 分岐）は各 Client に残す
-- （verify-worker-http-client-timeout.sh の per-file 不変条件を維持するため）。
module NativeTrace.Worker.HttpSupport (
  mimeTypeToExtension,
  MultipartPart (..),
  buildMultipartBody,
  readTimeoutSecondsEnv,
)
where

import Data.ByteString (ByteString)
import Data.Text (Text)
import Data.Text qualified as Text
import Data.Text.Encoding qualified as TextEncoding
import System.Environment (lookupEnv)
import Text.Read (readMaybe)

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

-- | multipart/form-data の 1 パート。
-- partFileName が Just の場合のみ Content-Disposition に filename 句を付与する。
-- partContentType が Just の場合のみ Content-Type 行を付与する。
data MultipartPart = MultipartPart
  { partName :: Text,
    partFileName :: Maybe Text,
    partContentType :: Maybe Text,
    partBytes :: ByteString
  }

-- | multipart/form-data ボディを組み立てる。
-- 既存 4 ビルダー（AnalyzerClient の analyze 用・shadowing 用、AaiClient、GoldenSpeakerClient）が
-- 生成していた出力バイト列（sep / crlf / Content-Disposition 行 / 末尾 "--\r\n"）と完全一致する。
buildMultipartBody :: Text -> [MultipartPart] -> ByteString
buildMultipartBody boundary parts =
  let sep = TextEncoding.encodeUtf8 ("--" <> boundary)
      crlf = "\r\n"
      closing = sep <> "--\r\n"
      contentTypeLine part =
        maybe
          ""
          (\contentType -> TextEncoding.encodeUtf8 ("Content-Type: " <> contentType <> "\r\n"))
          (partContentType part)
      renderPart part =
        sep
          <> crlf
          <> TextEncoding.encodeUtf8 (dispositionLine part)
          <> contentTypeLine part
          <> crlf
          <> partBytes part
          <> crlf
   in mconcat (map renderPart parts) <> closing

-- | 1 パート分の Content-Disposition 行を組み立てる。
dispositionLine :: MultipartPart -> Text
dispositionLine part =
  "Content-Disposition: form-data; name=\""
    <> partName part
    <> "\""
    <> maybe "" (\fileName -> "; filename=\"" <> fileName <> "\"") (partFileName part)
    <> "\r\n"

-- | timeout 秒数を環境変数から読む。未設定 / 不正時は 120 秒を返す。
readTimeoutSecondsEnv :: String -> IO Int
readTimeoutSecondsEnv envVarName = do
  maybeRaw <- lookupEnv envVarName
  pure $ case maybeRaw >>= readMaybe of
    Just n | n > 0 -> n
    _ -> 120
