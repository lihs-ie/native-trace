# rubric pack: Python (FastAPI / onion)

FastAPI の `APIRouter` を Composition Root (`app.py`) で `include_router` し忘れる未配線が最頻。
onion の純粋性 (domain / use-case が framework・IO・外部 SDK に依存しない) と、placeholder
(`raise NotImplementedError` / 関数本体が `...` or `pass` のみ) の残置を重点検査する。

## 追加判定項目
- 新規 `APIRouter` の endpoint が `app.py` の FastAPI Composition Root で `include_router` され、
  起動して当該 path に到達する (router 定義だけで include されていないのは未配線)。
- domain / use-case 層が FastAPI / pydantic の IO・外部 SDK・`os.environ` 直読みに依存していない
  (依存方向が内→外に逆流していない。境界は interface / infrastructure 層に閉じる)。
- handler / service が `raise NotImplementedError` や本体 `...` / `pass` だけの placeholder を残していない。
- 新規 public 関数が本番呼び出し箇所から実参照される (`grep -rn '<fn>' src --include='*.py'`)。
- DI / 構成値は composition root に閉じ、設定の env 読みが domain / use-case に漏れていない。

## 推奨証拠
- `pytest` (domain は pure unit、interface は `TestClient` で endpoint を実行 assert)。
- `ruff` / `mypy` (lint・型)。
- FastAPI `TestClient` で対象 endpoint を実際に叩き、response が期待 shape (空でない) であることを assert
  (200 が返るだけ・router が定義されただけでは PASS にしない)。
- ast-grep / grep の no-prod-doubles ルール (本番 import の `unittest.mock` / `MagicMock` を restrict)。
