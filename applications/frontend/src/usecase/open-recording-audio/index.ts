import { type ResultAsync, errAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, validationFailed } from "../../domain/shared";
import { createRecordingAttemptIdentifier } from "../../domain/recording-attempt";
import { type RecordingAttemptRepository } from "../port/recording-attempt-repository";
import { type AudioFileRepository } from "../port/audio-file-repository";
import { parseInput } from "../shared/validation";

// ---- Input ----

const openRecordingAudioSchema = z.object({
  recordingAttempt: z.string().min(1, "録音試行IDは空にできません"),
});

export type OpenRecordingAudioInput = z.infer<typeof openRecordingAudioSchema>;

// ---- Output ----

export type OpenRecordingAudioOutput = Readonly<{
  audioFile: Readonly<{
    identifier: string;
  }>;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}>;

// ---- Dependencies ----

export type OpenRecordingAudioDependencies = Readonly<{
  recordingAttemptRepository: RecordingAttemptRepository;
  audioFileRepository: AudioFileRepository;
}>;

// ---- Implementation ----

export const createOpenRecordingAudio =
  (dependencies: OpenRecordingAudioDependencies) =>
  (input: OpenRecordingAudioInput): ResultAsync<OpenRecordingAudioOutput, DomainError> => {
    const parsedInput = parseInput(openRecordingAudioSchema, input);
    if (parsedInput.isErr()) {
      return errAsync(parsedInput.error);
    }
    const parsed = parsedInput.value;

    const recordingAttemptIdentifier = createRecordingAttemptIdentifier(parsed.recordingAttempt);
    if (!recordingAttemptIdentifier) {
      return errAsync(validationFailed("recordingAttempt", "不正な録音試行IDです"));
    }

    // Ready RecordingAttempt のみ対象
    return dependencies.recordingAttemptRepository
      .find(recordingAttemptIdentifier)
      .andThen((readyAttempt) =>
        dependencies.audioFileRepository
          .findByRecordingAttempt(readyAttempt.identifier)
          .map((audioFile) => ({
            audioFile: {
              identifier: audioFile.identifier as string,
            },
            storageKey: audioFile.storageKey as string,
            mimeType: audioFile.mimeType as string,
            sizeBytes: audioFile.sizeBytes,
          })),
      );
  };
