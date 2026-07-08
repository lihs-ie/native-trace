import { err, ok, type Result } from "neverthrow";
import { type z } from "zod";
import { type DomainError, validationFailed } from "../../domain/shared";

export const parseInput = <Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): Result<z.infer<Schema>, DomainError> => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return err(
      validationFailed(
        "input",
        parsed.error.errors.map((zodIssue) => zodIssue.message).join(", "),
      ),
    );
  }
  return ok(parsed.data);
};
