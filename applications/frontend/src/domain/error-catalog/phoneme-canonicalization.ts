/**
 * phoneme-canonicalization — 音素記号の正規化（域: domain/error-catalog, I/O なし）
 *
 * 設計の正: docs/specs/deterministic-how-catalog-depth.md (M-HOW-1)
 * ADR: adr/020-deterministic-how-catalog-depth-articulatory-diagrams.md (D0)
 *
 * このモジュールは catalog 突合と diagnostic 突合が同一の正規化規則を共有するために
 * usecase/complete-diagnostic-session から domain 層に昇格した（ADR-020 D0）。
 * 移動前の所在: usecase/complete-diagnostic-session/index.ts:188-209。
 *
 * domain 純粋性: I/O なし、副作用なし。
 */

/**
 * normalizeIpaSymbol — IPA 記号から角括弧 `[...]` やスラッシュ `/.../` を除去して比較用文字列に正規化する。
 * catalog confusionSet は "[ɾ]" 形式、targetPhoneme は "/l/" 形式で格納されている。
 * worker の detectedTopCandidate / expected IPA tokens は括弧なし形式。
 */
export const normalizeIpaSymbol = (symbol: string): string =>
  symbol.replace(/^\[/, "").replace(/\]$/, "").replace(/^\//, "").replace(/\/$/, "").trim();

/**
 * PHONEME_ALIASES — 音素エイリアスマップ。
 * worker が出力する IPA 記号と catalog の IPA 記号が異なる場合の対応。
 * 例: ɹ（英語 /r/ のそり舌接近音）→ ɾ（弾き音: catalog confusionSet の表記）
 * 例: r → ɾ（ラテン文字 r を弾き音に正規化）
 * ADR-020 D0: このマップは catalog 突合と diagnostic 突合が共有するドメイン知識として
 * domain 層に昇格した（旧: usecase 層、DD-293 参照）。
 */
export const PHONEME_ALIASES: Readonly<Record<string, string>> = {
  ɹ: "ɾ", // そり舌接近音 → 弾き音（catalog 表記）
  r: "ɾ", // ラテン文字 r → 弾き音
};

/**
 * canonicalizePhoneme — 音素記号を canonical 形式に正規化する（括弧除去 + エイリアス解決）。
 */
export const canonicalizePhoneme = (symbol: string): string => {
  const stripped = normalizeIpaSymbol(symbol);
  return PHONEME_ALIASES[stripped] ?? stripped;
};
