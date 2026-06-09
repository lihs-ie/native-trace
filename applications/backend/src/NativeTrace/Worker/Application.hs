module NativeTrace.Worker.Application (
  application,
)
where

import Data.Aeson (Value)
import NativeTrace.Worker.Api (WorkerApi, workerApi)
import NativeTrace.Worker.Types (HealthResponse (..), VersionResponse (..))
import Network.Wai (Application)
import Servant (Handler, Server, err501, serve, throwError, (:<|>) (..))

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

-- 解析本体は未実装。API境界だけを先に固定し、実装が入るまで 501 を返す。
assessPronunciation :: Value -> Handler Value
assessPronunciation _ = throwError err501
