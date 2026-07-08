import { err, ok } from "neverthrow";
import { type Result } from "neverthrow";
import {
  type Brand,
  type DomainError,
  type NonEmptyList,
  createNonEmptyBrandedString,
  validationFailed,
} from "./shared";

export type MaterialIdentifier = Brand<string, "MaterialIdentifier">;
export type MaterialTitle = Brand<string, "MaterialTitle">;

export const createMaterialIdentifier = (value: string): MaterialIdentifier | null =>
  createNonEmptyBrandedString<MaterialIdentifier>(value);

export const createMaterialTitle = (value: string): Result<MaterialTitle, DomainError> => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return err(validationFailed("title", "タイトルは空にできません"));
  return ok(trimmed as MaterialTitle);
};

export type MaterialSource = Readonly<{
  sourceType: string;
  url: string | null;
  sourceTitle: string | null;
  speakerName: string | null;
}>;

export const createMaterialSource = (
  input: Readonly<{
    sourceType: string;
    url?: string | null;
    sourceTitle?: string | null;
    speakerName?: string | null;
  }>,
): Result<MaterialSource, DomainError> => {
  if (!input.sourceType || input.sourceType.trim().length === 0) {
    return err(validationFailed("sourceType", "ソースタイプは空にできません"));
  }
  return ok({
    sourceType: input.sourceType.trim(),
    url: input.url?.trim() ?? null,
    sourceTitle: input.sourceTitle?.trim() ?? null,
    speakerName: input.speakerName?.trim() ?? null,
  });
};

export type ActiveMaterial = Readonly<{
  type: "active";
  identifier: MaterialIdentifier;
  title: MaterialTitle;
  source: MaterialSource | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type DeletedMaterial = Readonly<{
  type: "deleted";
  identifier: MaterialIdentifier;
  title: MaterialTitle;
  deletedAt: Date;
}>;

export type Material = ActiveMaterial | DeletedMaterial;

// DomainEvent
export type MaterialCreated = Readonly<{
  type: "materialCreated";
  material: ActiveMaterial;
  occurredAt: Date;
}>;

export type MaterialRevised = Readonly<{
  type: "materialRevised";
  material: ActiveMaterial;
  occurredAt: Date;
}>;

export type MaterialRetired = Readonly<{
  type: "materialRetired";
  material: DeletedMaterial;
  occurredAt: Date;
}>;

// Factory
export type CreateMaterialOutput = Readonly<{
  material: ActiveMaterial;
  events: NonEmptyList<MaterialCreated>;
}>;

export const createMaterial = (
  input: Readonly<{
    identifier: MaterialIdentifier;
    title: MaterialTitle;
    source: MaterialSource | null;
    now: Date;
  }>,
): CreateMaterialOutput => {
  const material: ActiveMaterial = {
    type: "active",
    identifier: input.identifier,
    title: input.title,
    source: input.source,
    createdAt: input.now,
    updatedAt: input.now,
  };
  return {
    material,
    events: [{ type: "materialCreated", material, occurredAt: input.now }],
  };
};

export type ReviseMaterialOutput = Readonly<{
  material: ActiveMaterial;
  events: NonEmptyList<MaterialRevised>;
}>;

export const reviseMaterial = (
  material: ActiveMaterial,
  input: Readonly<{
    title: MaterialTitle;
    source: MaterialSource | null;
    now: Date;
  }>,
): ReviseMaterialOutput => {
  const revised: ActiveMaterial = {
    ...material,
    title: input.title,
    source: input.source,
    updatedAt: input.now,
  };
  return {
    material: revised,
    events: [{ type: "materialRevised", material: revised, occurredAt: input.now }],
  };
};

export type RetireMaterialOutput = Readonly<{
  material: DeletedMaterial;
  events: NonEmptyList<MaterialRetired>;
}>;

export const retireMaterial = (material: ActiveMaterial, now: Date): RetireMaterialOutput => {
  const deleted: DeletedMaterial = {
    type: "deleted",
    identifier: material.identifier,
    title: material.title,
    deletedAt: now,
  };
  return {
    material: deleted,
    events: [{ type: "materialRetired", material: deleted, occurredAt: now }],
  };
};
