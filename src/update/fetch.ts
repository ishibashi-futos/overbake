/**
 * `fetch` の構造的サブセット型。
 * グローバル `fetch` はこの型に代入可能で、テストでは引数の少ない fake を渡せる。
 */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<Response>;
