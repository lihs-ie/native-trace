import { describe, expect, it } from "vitest";
import { normalizeAudioMimeType } from "./mime";

describe("normalizeAudioMimeType", () => {
  it("codecs パラメータ付き audio/webm を audio/webm に正規化する", () => {
    expect(normalizeAudioMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
  });

  it("スペースあり codecs パラメータ付き audio/ogg を audio/ogg に正規化する", () => {
    expect(normalizeAudioMimeType("audio/ogg; codecs=opus")).toBe("audio/ogg");
  });

  it("大文字 AUDIO/WAV を小文字 audio/wav に正規化する", () => {
    expect(normalizeAudioMimeType("AUDIO/WAV")).toBe("audio/wav");
  });

  it("パラメータなし audio/mp4 はそのまま返す", () => {
    expect(normalizeAudioMimeType("audio/mp4")).toBe("audio/mp4");
  });

  it("前後空白を除去する", () => {
    expect(normalizeAudioMimeType("  audio/mpeg  ")).toBe("audio/mpeg");
  });

  it("複数パラメータがある場合もベース型のみ返す", () => {
    expect(normalizeAudioMimeType("audio/webm;codecs=opus;bitrate=128000")).toBe("audio/webm");
  });
});
