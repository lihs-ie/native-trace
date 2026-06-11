import { describe, expect, it } from "vitest";
import { toSeverityClass } from "./severity";

describe("toSeverityClass", () => {
  it("suggestion を suggest に変換する", () => {
    expect(toSeverityClass("suggestion")).toBe("suggest");
  });

  it("critical/major/minor はそのまま返す", () => {
    expect(toSeverityClass("critical")).toBe("critical");
    expect(toSeverityClass("major")).toBe("major");
    expect(toSeverityClass("minor")).toBe("minor");
  });

  it("suggest はそのまま返す", () => {
    expect(toSeverityClass("suggest")).toBe("suggest");
  });
});
