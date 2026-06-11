export type EntropyProvider = Readonly<{
  generateUlid: () => string;
  generateUuidV4: () => string;
}>;
