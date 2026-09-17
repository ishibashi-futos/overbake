// `import text from "./file.md" with { type: "text" }` の型宣言。
// Bun はテキストとして読み込み、`bun build --compile` ではバイナリに埋め込む。
declare module "*.md" {
  const content: string;
  export default content;
}
