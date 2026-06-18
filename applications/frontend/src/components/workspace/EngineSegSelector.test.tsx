/**
 * EngineSegSelector unit tests
 *
 * Done When:
 * - 3 seg-item buttons are rendered
 * - the button matching `value` has `is-active` class; others do not
 * - clicking a button calls `onChange` with the corresponding AnalysisMode
 */

import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EngineSegSelector } from "./EngineSegSelector";

describe("EngineSegSelector", () => {
  it("renders three seg-item buttons", () => {
    const { container } = render(
      <EngineSegSelector value="comparison" onChange={() => undefined} />,
    );
    const buttons = container.querySelectorAll(".seg-item");
    expect(buttons).toHaveLength(3);
  });

  it("applies is-active to the cloudOnly button when value is cloudOnly", () => {
    const { container } = render(
      <EngineSegSelector value="cloudOnly" onChange={() => undefined} />,
    );
    const buttons = container.querySelectorAll(".seg-item");
    expect(buttons[0]).toHaveClass("is-active");
    expect(buttons[1]).not.toHaveClass("is-active");
    expect(buttons[2]).not.toHaveClass("is-active");
  });

  it("applies is-active to the ossWorkerOnly button when value is ossWorkerOnly", () => {
    const { container } = render(
      <EngineSegSelector value="ossWorkerOnly" onChange={() => undefined} />,
    );
    const buttons = container.querySelectorAll(".seg-item");
    expect(buttons[0]).not.toHaveClass("is-active");
    expect(buttons[1]).toHaveClass("is-active");
    expect(buttons[2]).not.toHaveClass("is-active");
  });

  it("applies is-active to the comparison button when value is comparison", () => {
    const { container } = render(
      <EngineSegSelector value="comparison" onChange={() => undefined} />,
    );
    const buttons = container.querySelectorAll(".seg-item");
    expect(buttons[0]).not.toHaveClass("is-active");
    expect(buttons[1]).not.toHaveClass("is-active");
    expect(buttons[2]).toHaveClass("is-active");
  });

  it("calls onChange with cloudOnly when OpenAI API button is clicked", async () => {
    const handleChange = vi.fn();
    const { container } = render(
      <EngineSegSelector value="comparison" onChange={handleChange} />,
    );
    await userEvent.click(within(container).getByRole("button", { name: /openai api/i }));
    expect(handleChange).toHaveBeenCalledOnce();
    expect(handleChange).toHaveBeenCalledWith("cloudOnly");
  });

  it("calls onChange with ossWorkerOnly when OSS Worker button is clicked", async () => {
    const handleChange = vi.fn();
    const { container } = render(
      <EngineSegSelector value="cloudOnly" onChange={handleChange} />,
    );
    await userEvent.click(within(container).getByRole("button", { name: /oss worker/i }));
    expect(handleChange).toHaveBeenCalledOnce();
    expect(handleChange).toHaveBeenCalledWith("ossWorkerOnly");
  });

  it("calls onChange with comparison when ⊕ 比較 button is clicked", async () => {
    const handleChange = vi.fn();
    const { container } = render(
      <EngineSegSelector value="cloudOnly" onChange={handleChange} />,
    );
    await userEvent.click(within(container).getByRole("button", { name: /⊕ 比較/i }));
    expect(handleChange).toHaveBeenCalledOnce();
    expect(handleChange).toHaveBeenCalledWith("comparison");
  });

  it("data-eng attribute is set on each button", () => {
    const { container } = render(
      <EngineSegSelector value="comparison" onChange={() => undefined} />,
    );
    const buttons = container.querySelectorAll(".seg-item");
    expect(buttons[0]).toHaveAttribute("data-eng", "openai");
    expect(buttons[1]).toHaveAttribute("data-eng", "rust");
    expect(buttons[2]).toHaveAttribute("data-eng", "compare");
  });
});
