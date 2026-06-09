module Main (
  main,
)
where

import Data.Maybe (fromMaybe)
import NativeTrace.Worker.Application (application)
import Network.Wai.Handler.Warp (run)
import System.Environment (lookupEnv)
import Text.Read (readMaybe)

defaultPort :: Int
defaultPort = 8787

main :: IO ()
main = do
  portText <- lookupEnv "WORKER_PORT"
  let port = fromMaybe defaultPort (portText >>= readMaybe)
  putStrLn ("native-trace-worker listening on port " <> show port)
  run port application
