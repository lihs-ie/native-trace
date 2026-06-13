/**
 * DrillContentRepository — 産出ドリルコンテンツ取得ポート
 *
 * 設計の正: docs/specs/training-screen.md (M-TR-4, REQ-123)
 *          adr/007-training-context-bounded-context.md (識別子のみ参照)
 *
 * Training Context UseCase は本ポート経由でドリルコンテンツを取得する。
 * 実装は infrastructure/training/drill-content-adapter に置く（onion 順守）。
 */

// ---- ドリルコンテンツ型（Port で定義し、usecase・infrastructure が共有） ----

export type MinimalPair = Readonly<{
  /** 対象音素を含む語 */
  targetWord: string;
  /** 混同されやすい音素を含む語 */
  contrastWord: string;
  /** 対象音素 IPA（targetWord に含まれる音素） */
  targetPhonemeIpa: string;
  /** 対比音素 IPA（contrastWord に含まれる音素） */
  contrastPhonemeIpa: string;
}>;

export type DrillContent = Readonly<{
  /** japanese-l1-catalog.json の id */
  catalogId: string;
  /** 対立表記（例: "/l/-/r/"） */
  contrast: string;
  /** 対象音素 IPA（例文中で評価対象となる音素） */
  targetPhonemes: ReadonlyArray<string>;
  /** ミニマルペア群（複数ペアで多角的に練習） */
  minimalPairs: ReadonlyArray<MinimalPair>;
  /** 産出練習文（対象音素を複数含む） */
  exampleSentence: string;
  /** 例文中の対象音素出現位置を IPA 系列として列挙（評価時に絞り込みに使用） */
  exampleTargetPhonemeIpas: ReadonlyArray<string>;
  /** 指導ヒント（表示用日本語テキスト） */
  hintJa: string;
}>;

// ---- Port ----

export type DrillContentRepository = Readonly<{
  /**
   * findByCatalogId — catalogId でドリルコンテンツを取得する。
   * 見つからない場合は null を返す。
   */
  findByCatalogId: (catalogId: string) => DrillContent | null;

  /**
   * findByContrast — contrast 文字列でドリルコンテンツを取得する。
   * 見つからない場合は null を返す。
   */
  findByContrast: (contrast: string) => DrillContent | null;

  /**
   * getAll — 全ドリルコンテンツを返す。
   */
  getAll: () => ReadonlyArray<DrillContent>;
}>;
