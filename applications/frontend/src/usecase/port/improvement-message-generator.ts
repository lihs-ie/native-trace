/**
 * ImprovementMessageGenerator port。
 * UseCase 層が messageJa を生成するための依存インターフェース。
 * 実装は ACL 層に置く。クラス構文禁止。
 */

export type ImprovementMessageGeneratorInput = Readonly<{
  phenomenon: string;
  expected: Readonly<{ text: string | null; ipa: string | null }>;
  detected: Readonly<{ text: string | null; ipa: string | null }>;
}>;

export type ImprovementMessageGenerator = Readonly<{
  generate: (input: ImprovementMessageGeneratorInput) => string;
}>;
