declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type AnalysisEngineIdentifier = Brand<string, "AnalysisEngineIdentifier">;
export type AnalysisEngineDisplayName = Brand<
  string,
  "AnalysisEngineDisplayName"
>;
export type AnalysisEngineConfiguration = Readonly<Record<string, unknown>>;

export type CloudAnalysisEngine = Readonly<{
  type: "cloud";
  identifier: AnalysisEngineIdentifier;
  displayName: AnalysisEngineDisplayName;
  provider: string;
  modelName: string;
  externalSendingRequired: true;
  enabled: boolean;
  configuration: AnalysisEngineConfiguration;
}>;

export type OssWorkerAnalysisEngine = Readonly<{
  type: "oss_worker";
  identifier: AnalysisEngineIdentifier;
  displayName: AnalysisEngineDisplayName;
  workerVersion: string;
  modelName: string;
  rulesetVersion: string;
  enabled: boolean;
  configuration: AnalysisEngineConfiguration;
}>;

export type AnalysisEngine = CloudAnalysisEngine | OssWorkerAnalysisEngine;
