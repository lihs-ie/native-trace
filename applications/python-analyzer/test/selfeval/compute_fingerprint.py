"""analyzer 指紋の計算と manifest への書き込み（ADR-031 D12 Stage-3 / M-DRIFT-1）。

使用方法:
    python3 applications/python-analyzer/test/selfeval/compute_fingerprint.py --write

    --write を付けると manifest.json の entries[*].observed.analyzerCommit が
    LIVE 指紋（docker:<sha256>|pip:<hex>）で上書きされる。

    --write なし（デフォルト）は指紋を stdout に出力するだけで manifest を変更しない。

依存: 標準ライブラリのみ（subprocess, hashlib, json, argparse, pathlib, sys）。
本番コードへの import は禁止（test scope 専用モジュール）。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys

# ---------------------------------------------------------------------------
# デフォルトパス定数
# ---------------------------------------------------------------------------

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
_DEFAULT_MANIFEST = os.path.join(
    _REPO_ROOT,
    "applications",
    "python-analyzer",
    "test",
    "fixtures",
    "corpus",
    "manifest.json",
)
_DEFAULT_DOCKERFILE = os.path.join(
    _REPO_ROOT,
    "applications",
    "python-analyzer",
    "Dockerfile",
)


# ---------------------------------------------------------------------------
# 純粋関数: Dockerfile pip-list hash（S-DRIFT-1 — docker 依存なし）
# ---------------------------------------------------------------------------


def _hash_pip_lines(dockerfile_path: str) -> str:
    """Dockerfile の pip install 行を抽出して SHA-256 hex を返す（純粋関数）。

    docker を呼び出さず、ファイルパスだけを引数に取るため
    pytest でネットワーク/docker なしでテスト可能（S-DRIFT-1）。

    Args:
        dockerfile_path: Dockerfile の絶対パスまたは相対パス。

    Returns:
        pip install / pip3 install を含む行を改行結合した文字列の SHA-256 hex。
        該当行がゼロ件の場合も空文字列の SHA-256 を返す（エラーにしない）。
    """
    with open(dockerfile_path, encoding="utf-8") as file_handle:
        lines = file_handle.readlines()

    pip_lines = [
        line.rstrip("\n") for line in lines if "pip install" in line or "pip3 install" in line
    ]
    joined = "\n".join(pip_lines)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# docker イメージ digest の取得
# ---------------------------------------------------------------------------


def _get_docker_image_id(image_name: str = "native-trace-analyzer") -> str:
    """docker inspect で analyzer イメージの Id を取得して返す。

    コンテナが起動していない / docker が利用できない場合は RuntimeError を送出する。
    呼び出し元は RuntimeError を「指紋 absent」として扱うこと。

    Args:
        image_name: `docker inspect` に渡すイメージ/コンテナ名。

    Returns:
        "sha256:..." 形式の文字列（先頭と末尾の空白は除去済み）。
    """
    result = subprocess.run(
        ["docker", "inspect", image_name, "--format", "{{.Id}}"],
        capture_output=True,
        text=True,
        timeout=15,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"docker inspect {image_name!r} returned exit code {result.returncode}. "
            f"stderr: {result.stderr.strip()!r}. "
            "Ensure the analyzer container is running before computing the fingerprint."
        )
    docker_id = result.stdout.strip()
    if not docker_id:
        raise RuntimeError(
            f"docker inspect {image_name!r} returned an empty Id. "
            "Ensure the analyzer container is running and the image name is correct."
        )
    return docker_id


# ---------------------------------------------------------------------------
# 複合指紋の計算
# ---------------------------------------------------------------------------


def compute_fingerprint(repo_root: str) -> str:
    """analyzer の複合指紋を計算して返す。

    指紋形式: "docker:<sha256:...>|pip:<hex>"

    構成要素:
        1. docker イメージ Id（docker inspect native-trace-analyzer --format '{{.Id}}'）
        2. Dockerfile の pip install 行の SHA-256 hex

    Args:
        repo_root: リポジトリルートの絶対パス。Dockerfile の解決に使用する。

    Returns:
        "docker:<sha256:...>|pip:<hex>" 形式の複合指紋文字列。

    Raises:
        RuntimeError: analyzer コンテナが起動していない場合（docker inspect 失敗）。
        FileNotFoundError: Dockerfile が存在しない場合。
    """
    dockerfile_path = os.path.join(repo_root, "applications", "python-analyzer", "Dockerfile")
    pip_hash = _hash_pip_lines(dockerfile_path)
    docker_id = _get_docker_image_id("native-trace-analyzer")
    return f"docker:{docker_id}|pip:{pip_hash}"


# ---------------------------------------------------------------------------
# manifest への書き込み
# ---------------------------------------------------------------------------


def write_fingerprint_to_manifest(manifest_path: str, fingerprint: str) -> None:
    """manifest.json の全 entries[*].observed.analyzerCommit を fingerprint で上書きする。

    IPA unicode（ɛ, ɜː, oʊ 等）と _comment 配列を含む既存構造を保持する。

    Args:
        manifest_path: manifest.json の絶対パスまたは相対パス。
        fingerprint: compute_fingerprint() が返す複合指紋文字列。
    """
    with open(manifest_path, encoding="utf-8") as file_handle:
        manifest = json.load(file_handle)

    for entry in manifest.get("entries", []):
        observed = entry.setdefault("observed", {})
        observed["analyzerCommit"] = fingerprint

    with open(manifest_path, "w", encoding="utf-8") as file_handle:
        json.dump(manifest, file_handle, indent=2, ensure_ascii=False)
        file_handle.write("\n")


# ---------------------------------------------------------------------------
# CLI エントリポイント
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "analyzer 指紋を計算し、オプションで manifest.json に書き込む"
            "（ADR-031 D12 Stage-3）。\n"
            "--write を付けると manifest の analyzerCommit が LIVE 指紋で上書きされる。\n"
            "--write なし（デフォルト）は指紋を stdout に出力するだけで manifest を変更しない。"
        )
    )
    parser.add_argument(
        "--write",
        action="store_true",
        default=False,
        help="manifest.json の analyzerCommit を LIVE 指紋で上書きする（明示的なオプトイン）",
    )
    parser.add_argument(
        "--repo-root",
        default=_REPO_ROOT,
        help=f"リポジトリルートのパス（デフォルト: {_REPO_ROOT}）",
    )
    parser.add_argument(
        "--manifest",
        default=_DEFAULT_MANIFEST,
        help=f"manifest.json のパス（デフォルト: {_DEFAULT_MANIFEST}）",
    )
    arguments = parser.parse_args()

    try:
        fingerprint = compute_fingerprint(arguments.repo_root)
    except RuntimeError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    except FileNotFoundError as error:
        print(f"ERROR: Dockerfile not found: {error}", file=sys.stderr)
        return 1

    print(f"fingerprint={fingerprint}")

    if arguments.write:
        write_fingerprint_to_manifest(arguments.manifest, fingerprint)
        print(f"WROTE analyzerCommit to {arguments.manifest}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
