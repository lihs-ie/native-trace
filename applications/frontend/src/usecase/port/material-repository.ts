import { type ResultAsync } from "neverthrow";
import {
  type Material,
  type ActiveMaterial,
  type MaterialIdentifier,
} from "../../domain/material";
import { type MaterialSearchCriteria } from "../../domain/criteria";
import { type DomainError } from "../../domain/shared";

export type MaterialPage = Readonly<{
  items: ReadonlyArray<Material>;
  total: number;
}>;

export type MaterialRepository = Readonly<{
  find: (identifier: MaterialIdentifier) => ResultAsync<ActiveMaterial, DomainError>;
  search: (criteria: MaterialSearchCriteria) => ResultAsync<MaterialPage, DomainError>;
  persist: (material: Material) => ResultAsync<void, DomainError>;
}>;
