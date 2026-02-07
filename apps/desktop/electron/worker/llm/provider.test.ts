import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudProvider, NullProvider, type LLMProvider } from "./provider";
import { completeJsonWithRetry } from "./validator";

const baseRequest = {
  schemaName: "test_schema",
  systemPrompt: "You are a strict extractor.",
  userPrompt: "Extract facts from this passage.",
  jsonSchema: {
    type: "object",
    properties: {
      answer: { type: "string" }
    },
    required: ["answer"],
    additionalProperties: false
  },
  temperature: 0.1,
  maxTokens: 256
} as const;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function textResponse(text: string, status: number): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain" }
  });
}

function parseFirstRequestBody(fetchMock: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const firstCall = fetchMock.mock.calls[0];
  const init = firstCall?.[1] as RequestInit | undefined;
  if (!init || typeof init.body !== "string") {
    throw new Error("Expected first fetch call to include a JSON string body");
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

function abortError(message: string): Error {
  const error = new Error(message);
  Object.defineProperty(error, "name", { value: "AbortError" });
  return error;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CloudProvider", () => {
  it("routes /v1/responses requests through OpenAI Responses format", async () => {
    const fetchMock = vi.fn<[string | URL, RequestInit?], Promise<Response>>(async () =>
      jsonResponse({
        output_parsed: { answer: "ok" },
        usage: { total_tokens: 42 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudProvider("https://llm.example.test/v1/responses/", "api-key", "gpt-5.2");

    const result = await provider.completeJSON<{ answer: string }>(baseRequest);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://llm.example.test/v1/responses/");

    const init = call?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(init?.method).toBe("POST");
    expect(headers.Authorization).toBe("Bearer api-key");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = parseFirstRequestBody(fetchMock);
    expect(body).toMatchObject({
      model: "gpt-5.2",
      temperature: baseRequest.temperature,
      max_output_tokens: baseRequest.maxTokens
    });
    expect(body.maxTokens).toBeUndefined();
    expect(body).toHaveProperty("input");
    expect(body).toHaveProperty("text");
    expect((body as { input: unknown }).input).toEqual([
      { role: "system", content: baseRequest.systemPrompt },
      { role: "user", content: baseRequest.userPrompt }
    ]);
    expect((body as { text: unknown }).text).toEqual({
      format: {
        type: "json_schema",
        name: baseRequest.schemaName,
        schema: baseRequest.jsonSchema,
        strict: true
      }
    });

    expect(result).toEqual({
      json: { answer: "ok" },
      rawText: JSON.stringify({ answer: "ok" }),
      tokenUsage: { total_tokens: 42 }
    });
  });

  it("routes non-/v1/responses requests through generic cloud format", async () => {
    const fetchMock = vi.fn<[string | URL, RequestInit?], Promise<Response>>(async () =>
      jsonResponse({
        json: { answer: "ok" },
        rawText: '{"answer":"ok"}',
        tokenUsage: { prompt_tokens: 11 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudProvider("https://llm.example.test/v1/generate", "api-key", "gpt-generic");

    const result = await provider.completeJSON<{ answer: string }>(baseRequest);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = parseFirstRequestBody(fetchMock);
    expect(body).toMatchObject({
      model: "gpt-generic",
      schemaName: baseRequest.schemaName,
      systemPrompt: baseRequest.systemPrompt,
      userPrompt: baseRequest.userPrompt,
      jsonSchema: baseRequest.jsonSchema,
      temperature: baseRequest.temperature,
      maxTokens: baseRequest.maxTokens
    });
    expect(body.input).toBeUndefined();
    expect(body.text).toBeUndefined();
    expect(body.max_output_tokens).toBeUndefined();
    expect(result).toEqual({
      json: { answer: "ok" },
      rawText: '{"answer":"ok"}',
      tokenUsage: { prompt_tokens: 11 }
    });
  });

  it("parses OpenAI output_text JSON when output_parsed is missing", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        output_text: '{"answer":"from-output-text"}',
        usage: { total_tokens: 7 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudProvider("https://llm.example.test/v1/responses", "api-key", "gpt-5.2");

    const result = await provider.completeJSON<{ answer: string }>(baseRequest);

    expect(result).toEqual({
      json: { answer: "from-output-text" },
      rawText: '{"answer":"from-output-text"}',
      tokenUsage: { total_tokens: 7 }
    });
  });

  it("retries transient failures and succeeds before max retry limit", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary-1"))
      .mockRejectedValueOnce(new Error("temporary-2"))
      .mockResolvedValueOnce(jsonResponse({ output_parsed: { answer: "recovered" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudProvider("https://llm.example.test/v1/responses", "api-key", "gpt-5.2");

    const completionPromise = provider.completeJSON<{ answer: string }>(baseRequest);
    await vi.runAllTimersAsync();
    const completion = await completionPromise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(completion.json).toEqual({ answer: "recovered" });
  });

  it("stops retrying after max attempts on repeated network failures", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error("network-down"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudProvider("https://llm.example.test/v1/responses", "api-key", "gpt-5.2");

    const completionPromise = provider.completeJSON<{ answer: string }>(baseRequest);
    const rejection = expect(completionPromise).rejects.toThrow("network-down");
    await vi.runAllTimersAsync();
    await rejection;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("aborts timed-out requests and clears timeout handles between attempts", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const abortSignals: AbortSignal[] = [];
    const fetchMock = vi.fn((_: string | URL, init?: RequestInit) => {
      const signal = init?.signal;
      if (!signal) {
        return Promise.reject(new Error("missing abort signal"));
      }
      abortSignals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(abortError("request aborted"));
          },
          { once: true }
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudProvider("https://llm.example.test/v1/responses", "api-key", "gpt-5.2");

    const completionPromise = provider.completeJSON<{ answer: string }>(baseRequest);
    const rejection = expect(completionPromise).rejects.toThrow("request aborted");
    await vi.runAllTimersAsync();
    await rejection;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(abortSignals).toHaveLength(3);
    expect(abortSignals.every((signal) => signal.aborted)).toBe(true);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(3);
  });

  it("includes status details for non-OK API responses", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => textResponse("upstream exploded", 502));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudProvider("https://llm.example.test/v1/responses", "api-key", "gpt-5.2");

    const completionPromise = provider.completeJSON<{ answer: string }>(baseRequest);
    const rejection = expect(completionPromise).rejects.toThrow(
      "LLM request failed: 502: upstream exploded"
    );
    await vi.runAllTimersAsync();
    await rejection;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws a parse error when response text is not valid JSON", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => jsonResponse({ output_text: "not-json-at-all" }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudProvider("https://llm.example.test/v1/responses", "api-key", "gpt-5.2");

    const completionPromise = provider.completeJSON<{ answer: string }>(baseRequest);
    const rejection = expect(completionPromise).rejects.toThrow("LLM response was not valid JSON");
    await vi.runAllTimersAsync();
    await rejection;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("caps nested validator-provider-fetch retries at a bounded call count", async () => {
    vi.useFakeTimers();
    const cycle = { callCount: 0 };
    const fetchMock = vi.fn(async () => {
      cycle.callCount += 1;
      if (cycle.callCount % 3 === 0) {
        return jsonResponse({ output_parsed: {} });
      }
      throw new Error("transient upstream failure");
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudProvider("https://llm.example.test/v1/responses", "api-key", "gpt-5.2");

    const completionPromise = completeJsonWithRetry<{ answer: string }>(provider, baseRequest, 2);
    const rejection = expect(completionPromise).rejects.toThrow(
      "LLM output invalid after 3 attempts"
    );
    await vi.runAllTimersAsync();
    await rejection;

    expect(fetchMock).toHaveBeenCalledTimes(9);
  });
});

describe("NullProvider", () => {
  it("is unavailable and never calls fetch", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch should not be called");
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new NullProvider();

    await expect(provider.isAvailable()).resolves.toBe(false);
    await expect((provider as LLMProvider).completeJSON<{ answer: string }>(baseRequest)).rejects.toThrow(
      "NullProvider is not available"
    );
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
