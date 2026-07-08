/**
 * ACL 共通: fetch + timeout + json-tolerant-parse の骨格。
 * oss-worker 系 adaptor (pronunciation-assessment / shadowing-lag) から抽出。
 *
 * AbortController + setTimeout でタイムアウトを実装し、レスポンスの status と
 * JSON parse を試みた rawBody (parse 失敗時は null) を返す。
 * clearTimeout は成功パス・失敗パスの双方で呼ぶ。
 *
 * エラー分類 (classifyFetchError) と DomainError 変換は呼び出し側 adaptor の責務。
 * この関数は reject をそのまま re-throw するのみで catch しない。
 */
export const fetchJsonWithTimeout = (
  url: string,
  init: RequestInit,
  timeoutMilliseconds: number,
): Promise<{ status: number; rawBody: unknown }> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMilliseconds);

  return globalThis
    .fetch(url, { ...init, signal: controller.signal })
    .then(async (response) => {
      clearTimeout(timeoutId);
      const status = response.status;
      let rawBody: unknown;
      try {
        rawBody = await (response.json() as Promise<unknown>);
      } catch {
        rawBody = null;
      }
      return { status, rawBody };
    })
    .catch((error: unknown) => {
      clearTimeout(timeoutId);
      throw error;
    });
};
