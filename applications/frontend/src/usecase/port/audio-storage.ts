import { type ResultAsync } from "neverthrow";
import {
  type AudioFileIdentifier,
  type StorageKey,
  type AudioMimeType,
} from "../../domain/audio-file";
import { type DomainError } from "../../domain/shared";

export type AudioMetadata = Readonly<{
  mimeType: AudioMimeType;
  sizeBytes: number;
  durationMilliseconds: number;
  sha256: string;
  sampleRate?: number;
  channelCount?: number;
}>;

export type AudioRangeRequest = Readonly<{
  startByte?: number;
  endByte?: number;
}>;

export type AudioStreamResult = Readonly<{
  stream: NodeJS.ReadableStream;
  contentType: string;
  contentLength: number;
  totalBytes: number;
  rangeStart: number;
  rangeEnd: number;
}>;

export type AudioStorage = Readonly<{
  save: (
    audioFileIdentifier: AudioFileIdentifier,
    data: Buffer | NodeJS.ReadableStream,
    mimeType: string,
  ) => ResultAsync<Readonly<{ storageKey: StorageKey } & AudioMetadata>, DomainError>;
  stream: (
    storageKey: StorageKey,
    rangeRequest?: AudioRangeRequest,
  ) => ResultAsync<AudioStreamResult, DomainError>;
  delete: (storageKey: StorageKey) => ResultAsync<void, DomainError>;
}>;
