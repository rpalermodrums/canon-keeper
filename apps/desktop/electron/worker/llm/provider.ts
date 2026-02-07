export interface LLMProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  completeJSON<T>(req: {
    schemaName: string;
    systemPrompt: string;
    userPrompt: string;
    jsonSchema: object;
    temperature: number;
    maxTokens: number;
  }): Promise<{ json: T; rawText: string; tokenUsage?: unknown }>;
}

export class NullProvider implements LLMProvider {
  name = "null";
  async isAvailable(): Promise<boolean> {
    return false;
  }
  async completeJSON<T>(): Promise<{ json: T; rawText: string }> {
    throw new Error("NullProvider is not available");
  }
}

export class CloudProvider implements LLMProvider {
  name = "cloud";
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string
  ) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.baseUrl && this.apiKey && this.model);
  }

  private isOpenAIResponsesEndpoint(): boolean {
    const raw = this.baseUrl.trim();
    if (!raw) {
      return false;
    }
    try {
      const parsed = new URL(raw);
      return parsed.pathname.replace(/\/+$/, "") === "/v1/responses";
    } catch {
      return raw.replace(/\/+$/, "").endsWith("/v1/responses");
    }
  }

  private parseOpenAIResponseText(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const record = payload as {
      output_text?: unknown;
      output?: Array<{ content?: Array<{ text?: unknown; output_text?: unknown }> }>;
    };

    if (typeof record.output_text === "string" && record.output_text.trim()) {
      return record.output_text;
    }

    for (const item of record.output ?? []) {
      for (const part of item.content ?? []) {
        if (typeof part.text === "string" && part.text.trim()) {
          return part.text;
        }
        if (typeof part.output_text === "string" && part.output_text.trim()) {
          return part.output_text;
        }
      }
    }

    return null;
  }

  private async requestOpenAIResponses<T>(req: {
    schemaName: string;
    systemPrompt: string;
    userPrompt: string;
    jsonSchema: object;
    temperature: number;
    maxTokens: number;
    signal: AbortSignal;
  }): Promise<{ json: T; rawText: string; tokenUsage?: unknown }> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        input: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userPrompt }
        ],
        text: {
          format: {
            type: "json_schema",
            name: req.schemaName,
            schema: req.jsonSchema,
            strict: true
          }
        },
        temperature: req.temperature,
        max_output_tokens: req.maxTokens
      }),
      signal: req.signal
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      const suffix = detail ? `: ${detail}` : "";
      throw new Error(`LLM request failed: ${response.status}${suffix}`);
    }

    const data = (await response.json()) as {
      output_parsed?: T;
      usage?: unknown;
    };

    if (data.output_parsed !== undefined) {
      return {
        json: data.output_parsed,
        rawText: JSON.stringify(data.output_parsed),
        tokenUsage: data.usage
      };
    }

    const rawText = this.parseOpenAIResponseText(data);
    if (!rawText) {
      throw new Error("LLM response missing output text");
    }

    let parsed: T;
    try {
      parsed = JSON.parse(rawText) as T;
    } catch {
      throw new Error("LLM response was not valid JSON");
    }

    return {
      json: parsed,
      rawText,
      tokenUsage: data.usage
    };
  }

  private async requestGenericCloud<T>(req: {
    schemaName: string;
    systemPrompt: string;
    userPrompt: string;
    jsonSchema: object;
    temperature: number;
    maxTokens: number;
    signal: AbortSignal;
  }): Promise<{ json: T; rawText: string; tokenUsage?: unknown }> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        schemaName: req.schemaName,
        systemPrompt: req.systemPrompt,
        userPrompt: req.userPrompt,
        jsonSchema: req.jsonSchema,
        temperature: req.temperature,
        maxTokens: req.maxTokens
      }),
      signal: req.signal
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      const suffix = detail ? `: ${detail}` : "";
      throw new Error(`LLM request failed: ${response.status}${suffix}`);
    }

    const data = (await response.json()) as {
      json?: T;
      rawText?: string;
      tokenUsage?: unknown;
    };
    if (data.json !== undefined) {
      return {
        json: data.json,
        rawText: data.rawText ?? JSON.stringify(data.json),
        tokenUsage: data.tokenUsage
      };
    }

    return {
      json: data as T,
      rawText: JSON.stringify(data),
      tokenUsage: data.tokenUsage
    };
  }

  async completeJSON<T>(req: {
    schemaName: string;
    systemPrompt: string;
    userPrompt: string;
    jsonSchema: object;
    temperature: number;
    maxTokens: number;
  }): Promise<{ json: T; rawText: string; tokenUsage?: unknown }> {
    const maxRetries = 2;
    const timeoutMs = 30_000;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const result = this.isOpenAIResponsesEndpoint()
          ? await this.requestOpenAIResponses<T>({
              ...req,
              signal: controller.signal
            })
          : await this.requestGenericCloud<T>({
              ...req,
              signal: controller.signal
            });
        clearTimeout(timeout);
        return result;
      } catch (error) {
        clearTimeout(timeout);
        if (attempt < maxRetries) {
          const backoff = 500 * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
        throw error instanceof Error ? error : new Error("LLM request failed");
      }
    }

    throw new Error("LLM request failed");
  }
}
