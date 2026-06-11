// 環境変数アクセスは config/ ディレクトリ配下に閉じ込める規約のため、実装を移動した。
// 後方互換の re-export。
export type { AppConfig } from "./config/index";
export { createConfig } from "./config/index";
