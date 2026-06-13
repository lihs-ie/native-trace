#!/usr/bin/env bash
# verify-cc-by-nc-exclusion.sh
#
# Fitness check: assert that no CC BY-NC licensed assets are bundled as
# HVPT stimuli.
#
# ADR-009 / REQ-NF-101: L2-ARCTIC (CC BY-NC) and any CC BY-NC source must not
# be present in the bundled stimulus assets.
#
# Checks:
#   1. The attribution manifest (if it exists) contains no CC BY-NC license.
#   2. No path under the assets/stimuli directory contains known CC BY-NC
#      corpus names (l2arctic, L2-ARCTIC, l2-arctic, arctic).
#
# Exit 0 = no violations.
# Exit 1 = CC BY-NC content detected.

set -euo pipefail

ASSETS_DIR="applications/python-analyzer/src/python_analyzer/assets/stimuli"
MANIFEST_PATH="${ASSETS_DIR}/attribution-manifest.json"

violations=0

echo "=== CC BY-NC exclusion fitness check (ADR-009 / REQ-NF-101) ==="

# --- Check 1: manifest license fields ---
if [[ -f "${MANIFEST_PATH}" ]]; then
    echo "Checking manifest: ${MANIFEST_PATH}"
    if grep -iE '"licenseIdentifier"\s*:\s*"CC[- ]BY[- ]NC' "${MANIFEST_PATH}"; then
        echo "FAIL: CC BY-NC license found in attribution manifest"
        violations=$((violations + 1))
    else
        echo "OK: No CC BY-NC license in manifest"
    fi
else
    echo "INFO: No manifest found at ${MANIFEST_PATH} (carve pipeline not yet run)"
fi

# --- Check 2: path-based scan for known CC BY-NC corpus names ---
if [[ -d "${ASSETS_DIR}" ]]; then
    echo "Scanning paths under ${ASSETS_DIR}"
    if find "${ASSETS_DIR}" -type f | grep -iE "l2.?arctic|l2arctic"; then
        echo "FAIL: L2-ARCTIC path detected under stimulus assets"
        violations=$((violations + 1))
    else
        echo "OK: No L2-ARCTIC paths detected"
    fi
fi

# --- Check 3: source_corpus field in manifest must not mention L2-ARCTIC ---
if [[ -f "${MANIFEST_PATH}" ]]; then
    if grep -i "l2.arctic\|l2arctic" "${MANIFEST_PATH}"; then
        echo "FAIL: L2-ARCTIC source_corpus detected in manifest"
        violations=$((violations + 1))
    else
        echo "OK: No L2-ARCTIC source_corpus in manifest"
    fi
fi

echo "==="
if [[ "${violations}" -gt 0 ]]; then
    echo "FAIL: ${violations} CC BY-NC violation(s) detected"
    exit 1
else
    echo "PASS: CC BY-NC exclusion fitness check passed"
    exit 0
fi
