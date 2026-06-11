import { ulid } from "ulid";
import { randomUUID } from "crypto";
import { type EntropyProvider } from "../usecase/port/entropy-provider";

export const createEntropyProvider = (): EntropyProvider => ({
  generateUlid: () => ulid(),
  generateUuidV4: () => randomUUID(),
});
