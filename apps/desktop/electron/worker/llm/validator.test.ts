import { afterEach, describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "./provider";
import { completeJsonWithRetry, validateJson } from "./validator";

const schema = {
  type: "object",
  properties: {
    answer: { type: "string" },
    score: { type: "integer" }
  },
  required: ["answer"],
  additionalProperties: false
} as const;

const request = {
  schemaName: "validator_test",
  systemPrompt: "system",
  userPrompt: "user",
  jsonSchema: schema,
  temperature: 0.1,
  maxTokens: 100
} as const;

function createProviderMock(completeJSON: ReturnType<typeof vi.fn>): LLMProvider {
  return {
    name: "mock-provider",
    async isAvailable() {
      return true;
    },
    completeJSON: completeJSON as unknown as LLMProvider["completeJSON"]
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateJson", () => {
  it("returns ok: true for valid data", () => {
    const result = validateJson(schema, { answer: "ready", score: 3 });
    expect(result).toEqual({ ok: true });
  });

  it("returns ok: false with readable validation errors for invalid data", () => {
    const result = validateJson(schema, { answer: 5, extra: true });
    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.some((message) => message.includes("/answer must be string"))).toBe(true);
    expect(
      result.errors?.some((message) => message.includes("must NOT have additional properties"))
    ).toBe(true);
  });
});

describe("completeJsonWithRetry", () => {
  it("returns successful output on the first valid attempt", async () => {
    const completeJSON = vi.fn<unknown[], unknown>().mockResolvedValue({
      json: { answer: "first-pass" },
      rawText: '{"answer":"first-pass"}',
      tokenUsage: { total_tokens: 8 }
    });
    const provider = createProviderMock(completeJSON);

    const result = await completeJsonWithRetry<{ answer: string }>(provider, request, 2);

    expect(completeJSON).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      json: { answer: "first-pass" },
      rawText: '{"answer":"first-pass"}',
      tokenUsage: { total_tokens: 8 }
    });
  });

  it("retries once when first output is invalid, then succeeds", async () => {
    const completeJSON = vi
      .fn()
      .mockResolvedValueOnce({
        json: { score: 2 },
        rawText: '{"score":2}'
      })
      .mockResolvedValueOnce({
        json: { answer: "second-pass" },
        rawText: '{"answer":"second-pass"}'
      });
    const provider = createProviderMock(completeJSON);

    const result = await completeJsonWithRetry<{ answer: string }>(provider, request, 2);

    expect(completeJSON).toHaveBeenCalledTimes(2);
    expect(result.json).toEqual({ answer: "second-pass" });
  });

  it("exhausts retries and throws with validation error details", async () => {
    const completeJSON = vi.fn<unknown[], unknown>().mockResolvedValue({
      json: { score: 1 },
      rawText: '{"score":1}'
    });
    const provider = createProviderMock(completeJSON);

    await expect(completeJsonWithRetry<{ answer: string }>(provider, request, 2)).rejects.toThrow(
      "LLM output invalid after 3 attempts: must have required property 'answer'"
    );
    expect(completeJSON).toHaveBeenCalledTimes(3);
  });
});
