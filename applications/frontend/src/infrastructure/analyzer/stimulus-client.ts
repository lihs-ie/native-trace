/**
 * AnalyzerStimulusClient — analyzer GET /v1/stimuli を呼ぶ infrastructure 実装
 *
 * 設計の正: adr/009-hvpt-stimulus-hybrid-natural-tts.md
 *           docs/specs/training-screen.md (M-TR-5/6)
 *           docs/03-detailed-design/infrastructure.md §11.1
 *
 * process.env 参照は infrastructure/config のみ (ast-grep ルール準拠)。
 * analyzer の StimulusResponse 形状 (schema.py) と 1:1 で対応する。
 */

import { fromPromise, okAsync, errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { DomainError } from "../../domain/shared";
import type {
  AnalyzerStimulusClient,
  StimulusRecord,
} from "../../usecase/port/analyzer-stimulus-client";

type AnalyzerStimulusMetadata = Readonly<{
  stimulusIdentifier: string;
  contrast: string;
  word: string;
  speakerIdentifier: string;
  speakerSex: string;
  context: string;
  sourceCorpus: string;
  licenseIdentifier: string;
}>;

type AnalyzerStimulusResponse = Readonly<{
  metadata: AnalyzerStimulusMetadata;
  wavBase64: string;
}>;

type FetchOutcome =
  | { kind: "ok"; records: AnalyzerStimulusResponse[] }
  | { kind: "not_found"; contrast: string }
  | { kind: "error"; status: number };

const fetchStimuliFromAnalyzer = async (
  urlString: string,
  contrast: string,
): Promise<FetchOutcome> => {
  const response = await globalThis.fetch(urlString, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (response.status === 404) {
    return { kind: "not_found", contrast };
  }

  if (!response.ok) {
    return { kind: "error", status: response.status };
  }

  const records = (await response.json()) as AnalyzerStimulusResponse[];
  return { kind: "ok", records };
};

export const createAnalyzerStimulusClient = (
  analyzerApiEndpoint: string,
): AnalyzerStimulusClient => ({
  fetchStimuli: (
    contrast: string,
    context?: string,
    limit?: number,
  ): ResultAsync<ReadonlyArray<StimulusRecord>, DomainError> => {
    const resolvedLimit = limit ?? 20;
    const url = new URL(`${analyzerApiEndpoint}/v1/stimuli`);
    url.searchParams.set("contrast", contrast);
    if (context) {
      url.searchParams.set("context", context);
    }
    url.searchParams.set("limit", String(resolvedLimit));

    return fromPromise(
      fetchStimuliFromAnalyzer(url.toString(), contrast),
      (fetchError): DomainError => ({
        type: "persistenceFailed",
        reason: `analyzer /v1/stimuli への接続に失敗しました: ${String(fetchError)}`,
      }),
    ).andThen((outcome): ResultAsync<ReadonlyArray<StimulusRecord>, DomainError> => {
      if (outcome.kind === "not_found") {
        return errAsync({
          type: "notFound" as const,
          resource: "Stimulus",
          identifier: outcome.contrast,
        });
      }

      if (outcome.kind === "error") {
        return errAsync({
          type: "persistenceFailed" as const,
          reason: `analyzer /v1/stimuli がエラーを返しました (status: ${outcome.status})`,
        });
      }

      const stimuli: StimulusRecord[] = outcome.records.map((record) => ({
        stimulusIdentifier: record.metadata.stimulusIdentifier,
        contrast: record.metadata.contrast,
        word: record.metadata.word,
        speakerIdentifier: record.metadata.speakerIdentifier,
        speakerSex: record.metadata.speakerSex,
        context: record.metadata.context,
        sourceCorpus: record.metadata.sourceCorpus,
        licenseIdentifier: record.metadata.licenseIdentifier,
        wavBase64: record.wavBase64,
      }));

      return okAsync(stimuli as ReadonlyArray<StimulusRecord>);
    });
  },
});
