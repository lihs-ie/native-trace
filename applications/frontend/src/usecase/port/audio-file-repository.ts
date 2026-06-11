import { type ResultAsync } from "neverthrow";
import {
  type AudioFile,
  type StoredAudioFile,
  type AudioFileIdentifier,
} from "../../domain/audio-file";
import { type RecordingAttemptIdentifier } from "../../domain/recording-attempt";
import { type DomainError } from "../../domain/shared";

export type AudioFileRepository = Readonly<{
  find: (identifier: AudioFileIdentifier) => ResultAsync<StoredAudioFile, DomainError>;
  findByRecordingAttempt: (recordingAttempt: RecordingAttemptIdentifier) => ResultAsync<StoredAudioFile, DomainError>;
  persist: (audioFile: AudioFile) => ResultAsync<void, DomainError>;
}>;
