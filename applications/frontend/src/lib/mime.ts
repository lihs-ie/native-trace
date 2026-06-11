/**
 * MIME type normalization utilities（純関数）
 */

/**
 * audio MIME type のベース型を返す。
 * codecs/charset 等のパラメータ（";" 以降）を除去し、小文字・前後空白をトリムする。
 *
 * @example
 * normalizeAudioMimeType("audio/webm;codecs=opus")  // => "audio/webm"
 * normalizeAudioMimeType("audio/ogg; codecs=opus")  // => "audio/ogg"
 * normalizeAudioMimeType("AUDIO/WAV")               // => "audio/wav"
 * normalizeAudioMimeType("audio/mp4")               // => "audio/mp4"
 */
export const normalizeAudioMimeType = (raw: string): string =>
  raw.split(";")[0]!.trim().toLowerCase();
