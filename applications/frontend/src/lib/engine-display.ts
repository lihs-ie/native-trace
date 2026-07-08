/**
 * engine-display.ts — 純粋関数。副作用なし。
 * engineKind ("cloud" | "oss_worker") → 表示用 CSS 変数・ラベルの単一の変換元。
 *
 * W33: EngineTabs / EngineSegSelector / WorkspaceResultV2 / sections page /
 * compare page / history page の 6 箇所に発散していた
 * engineKind→色・ラベルのマッピングを集約した。
 * 呼び出し元ごとに現行値が一致しない箇所（compare page の oss_worker ラベル、
 * history のモード別短縮ラベル、EngineTabs の unknown フォールバック色）は
 * 各ファイル側でその値を維持するため、意図的にここへは統合していない。
 */

/**
 * engineKind → ドットの CSS `var()` 参照。
 * cloud → openai 変数、oss_worker → rust 変数。
 * それ以外（型上は起こらないが呼び出し元が独自の既定色を使う場合）は
 * unknownFallback で上書きできる（例: EngineTabs.tsx の `var(--text-faint)`）。
 */
export const engineColorVariable = (
  engineKind: string,
  unknownFallback: string = "var(--engine-rust)",
): string => {
  if (engineKind === "cloud") return "var(--engine-openai)";
  if (engineKind === "oss_worker") return "var(--engine-rust)";
  return unknownFallback;
};

/**
 * engineKind → 表示名（"OpenAI API" / "OSS Worker"）。
 * EngineTabs.tsx の missingEngineName、EngineSegSelector.tsx のボタンラベル、
 * compare/page.tsx の cloud ラベルで使う canonical な表示名。
 */
export const engineDisplayName = (engineKind: string): string => {
  if (engineKind === "oss_worker") return "OSS Worker";
  return "OpenAI API";
};
