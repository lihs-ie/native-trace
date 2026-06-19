#!/usr/bin/env bash
# agent-policy: python-analyzer / golden-speaker の src が実 import する third-party 依存が
# Dockerfile の *ハードコード pip install 行* に確実に含まれているかを純静的に検査する。
#
# 背景: 両サービスの Dockerfile は pyproject.toml ではなく手書きの `pip install` 行で依存を
#   焼き込む（build キャッシュ / CPU-only torch index 制御のため）。pyproject に依存を足しても
#   Dockerfile の pip 行を直し忘れると image にその distribution が入らず、起動時 import で
#   ModuleNotFoundError が握り潰され silent runtime dead-wiring になる。
#   incident: kokoro 2026-06-12 / scipy 2026-06-19（共に 2 回再発した P0 クラス）。
#   既存の wiring rule `python-analyzer-pyproject-needs-dockerfile` は pyproject↔Dockerfile の
#   *ファイル共変更*しか見ておらず、Dockerfile の *中身* に当該 distribution が入ったかは検査しない。
#   そのギャップ（co-change しても pip 行に書き忘れる）を本スクリプトが塞ぐ。
#
# 手順:
#   1. {python-analyzer, golden-speaker} のうち存在する dir について src/**/*.py の
#      top-level import / from import の module root を収集する。
#   2. stdlib（host python3.10+ の sys.stdlib_module_names、無ければ維持リスト）と
#      first-party（python_analyzer / golden_speaker / 相対 import）を除外し third-party だけ残す。
#   3. module->distribution を scripts/module-to-dist.txt で解決する。
#      stdlib でも first-party でも mapping にも無い module は FAIL（silent-skip しない＝盲点を再生産しない）。
#   4. Dockerfile の pip install ブロックを解析し installed distribution 集合を作る。
#   5. third-party import の distribution が (installed ∪ base-image-pip-allowlist) に無ければ exit 1。
#      service + module + 期待 distribution を出力する。全て満たせば service ごとに OK 行を出し exit 0。
#
# Docker は不要（純静的）。fitness hook（src の *.py 編集時）と CI（tree 全体）で実行する。
set -euo pipefail

repository_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$repository_root"

module_to_dist="scripts/module-to-dist.txt"
allowlist="scripts/base-image-pip-allowlist.txt"

if [ ! -f "$module_to_dist" ]; then
  echo "verify-analyzer-deps: $module_to_dist not found" >&2
  exit 1
fi

# --- distribution 名の正規化（lowercase / `_`->`-` / extras [..] 除去 / version 指定子除去）---
# 末尾に改行を付けて返す（per-token 呼び出しで 1 行 1 distribution に整列させるため）。
normalize_dist() {
  # 入力例: "praat-parselmouth>=0.4.3" / "uvicorn[standard]>=0.30.0" / "huggingface_hub"
  printf '%s\n' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/\[[^]]*\]//; s/[<>=!~;].*$//; s/_/-/g; s/[[:space:]]//g'
}

# --- stdlib 集合（host python が 3.10+ なら sys.stdlib_module_names、無ければ維持リスト）---
stdlib_list=""
if command -v python3 >/dev/null 2>&1; then
  stdlib_list="$(python3 -c 'import sys
names = getattr(sys, "stdlib_module_names", None)
if names and sys.version_info >= (3, 10):
    print("\n".join(sorted(names)))' 2>/dev/null || true)"
fi
if [ -z "$stdlib_list" ]; then
  # host python が 3.10 未満 / 取得失敗時の fallback（保守的に網羅。実 import で使う stdlib を含む）。
  stdlib_list="$(printf '%s\n' \
    __future__ abc argparse array asyncio base64 bisect builtins bz2 calendar collections \
    concurrent contextlib copy csv dataclasses datetime decimal difflib dis email enum errno \
    functools gc getpass gettext glob gzip hashlib heapq hmac html http imaplib importlib \
    inspect io ipaddress itertools json keyword logging lzma math mimetypes multiprocessing \
    numbers operator os pathlib pickle platform pprint queue random re secrets select shlex \
    shutil signal site smtplib socket sqlite3 ssl stat statistics string struct subprocess sys \
    sysconfig tarfile tempfile textwrap threading time timeit tkinter token tokenize traceback \
    types typing unicodedata unittest urllib uuid venv wave weakref xml zipfile zlib)"
fi
is_stdlib() {
  printf '%s\n' "$stdlib_list" | grep -qx -- "$1"
}

# --- first-party / relative import の判定 ---
is_first_party() {
  case "$1" in
    python_analyzer|golden_speaker) return 0 ;;
    "") return 0 ;;        # 相対 import（`from . import ...`）は module root が空になる
    *) return 1 ;;
  esac
}

# --- module->distribution 解決（未登録なら空文字を返す）---
resolve_dist() {
  local mod="$1" line m d
  while IFS= read -r line; do
    case "$line" in ''|\#*) continue ;; esac
    # 行末コメントは無し前提（module dist の 2 トークン）。先頭 2 トークンを取る。
    m="${line%%[[:space:]]*}"
    d="${line#"$m"}"
    d="$(printf '%s' "$d" | sed -E 's/^[[:space:]]+//; s/[[:space:]].*$//')"
    if [ "$m" = "$mod" ]; then
      printf '%s' "$d"
      return 0
    fi
  done < "$module_to_dist"
  printf ''
}

# --- allowlist（正規化済 distribution の集合を改行区切りで）---
allowlist_norm=""
if [ -f "$allowlist" ]; then
  while IFS= read -r line; do
    case "$line" in ''|\#*) continue ;; esac
    # 行内コメント（`dist  # 理由`）を許容。先頭トークンを distribution とみなす。
    tok="${line%%#*}"
    tok="$(printf '%s' "$tok" | sed -E 's/^[[:space:]]+//; s/[[:space:]].*$//')"
    [ -z "$tok" ] && continue
    allowlist_norm="${allowlist_norm}$(normalize_dist "$tok")
"
  done < "$allowlist"
fi
is_allowlisted() {
  printf '%s' "$allowlist_norm" | grep -qx -- "$1"
}

# --- Dockerfile の pip install 行から installed distribution（正規化済）を抽出 ---
# RUN pip install ... の継続行（`\` 連結）にまたがる package トークンを拾う。
# `--flag` / `--index-url URL` / `pip` / `install` / `--upgrade` などは除外する。
extract_installed_dists() {
  local dockerfile="$1"
  # 1) RUN 行から pip install を含む論理行を継続行込みで連結し、トークン分解する。
  awk '
    BEGIN { acc=""; ininstall=0 }
    {
      line=$0
      cont = (line ~ /\\[[:space:]]*$/)
      sub(/\\[[:space:]]*$/, "", line)
      if (line ~ /pip[[:space:]]+install/) { ininstall=1 }
      if (ininstall) { acc = acc " " line }
      if (ininstall && !cont) { print acc; acc=""; ininstall=0 }
    }
    END { if (ininstall && acc != "") print acc }
  ' "$dockerfile" \
  | tr -d '"'"'" \
  | tr ' \t' '\n\n' \
  | while IFS= read -r tok; do
      [ -z "$tok" ] && continue
      case "$tok" in
        RUN|pip|install|"&&"|"--no-cache-dir"|"--upgrade"|"--index-url"|"--pre") continue ;;
        --*) continue ;;
        http://*|https://*) continue ;;
        # `pip<24` のような pip 自体の固定は distribution ではない（pip は base image にある）。
        pip\<*|pip\>*|pip=*|"pip") continue ;;
      esac
      normalize_dist "$tok"
    done \
  | grep -v '^$' | sort -u
}

services="python-analyzer golden-speaker"

overall_violations=""
checked_any=0

for svc in $services; do
  src_dir="applications/$svc/src"
  dockerfile="applications/$svc/Dockerfile"
  [ -d "$src_dir" ] || continue
  checked_any=1

  if [ ! -f "$dockerfile" ]; then
    overall_violations="${overall_violations}[$svc] Dockerfile が見つかりません: $dockerfile
"
    continue
  fi

  installed="$(extract_installed_dists "$dockerfile")"

  # src の third-party module root を収集（top-level import / from import のみ）。
  modules="$(grep -rhoE '^[[:space:]]*(import|from)[[:space:]]+[a-zA-Z_][a-zA-Z0-9_.]*' "$src_dir" --include='*.py' 2>/dev/null \
    | sed -E 's/^[[:space:]]*(import|from)[[:space:]]+//; s/\..*$//' \
    | sort -u || true)"

  svc_violations=""
  while IFS= read -r mod; do
    [ -z "$mod" ] && continue
    [ "$mod" = "__future__" ] && continue
    is_first_party "$mod" && continue
    is_stdlib "$mod" && continue

    dist="$(resolve_dist "$mod")"
    if [ -z "$dist" ]; then
      # stdlib でも first-party でも mapping にも無い → 盲点。silent-skip せず FAIL させる。
      svc_violations="${svc_violations}  module '$mod' は third-party だが scripts/module-to-dist.txt に未登録です。
    -> 'module 行を追加してください: '$mod' <pip-distribution-name>'（stdlib/first-party 誤検出なら理由を確認）。
"
      continue
    fi

    dist_norm="$(normalize_dist "$dist")"
    if printf '%s\n' "$installed" | grep -qx -- "$dist_norm"; then
      continue
    fi
    if is_allowlisted "$dist_norm"; then
      continue
    fi
    svc_violations="${svc_violations}  import '$mod' -> distribution '$dist' が Dockerfile の pip install 行に含まれていません。
    -> applications/$svc/Dockerfile の pip install 行に '$dist' を追加してください（pyproject だけでは image に入りません）。
"
  done <<< "$modules"

  if [ -n "$svc_violations" ]; then
    overall_violations="${overall_violations}[$svc] Dockerfile 依存欠落:
$svc_violations"
  else
    echo "verify-analyzer-deps: [$svc] OK（src の third-party import は全て Dockerfile pip 行 or allowlist で充足）"
  fi
done

if [ "$checked_any" -eq 0 ]; then
  echo "verify-analyzer-deps: python-analyzer / golden-speaker の src が無い (skip)"
  exit 0
fi

if [ -n "$overall_violations" ]; then
  echo "POLICY VIOLATION: src が import する third-party 依存が Dockerfile の pip install 行に欠けています。" >&2
  printf '%s' "$overall_violations" >&2
  echo "理由: Dockerfile はハードコード pip list です。pyproject に足しても pip 行を直さないと image に入らず," >&2
  echo "      起動時 import で ModuleNotFoundError が握り潰され silent runtime dead-wiring になります。" >&2
  exit 1
fi
echo "verify-analyzer-deps: OK"
