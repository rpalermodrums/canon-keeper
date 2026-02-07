import Ajv2020 from "ajv/dist/2020";
import type { LLMProvider } from "./provider";

const ajv = new Ajv2020({ allErrors: true, strict: false });

export function validateJson(schema: object, data: unknown): { ok: boolean; errors?: string[] } {
  const validate = ajv.compile(schema);
  const ok = validate(data) as boolean;
  if (ok) return { ok: true };
  const errors = (validate.errors ?? []).map((err) => `${err.instancePath} ${err.message}`.trim());
  return { ok: false, errors };
}

export async function completeJsonWithRetry<T>(
  provider: LLMProvider,
  req: {
    schemaName: string;
    systemPrompt: string;
    userPrompt: string;
    jsonSchema: object;
    temperature: number;
    maxTokens: number;
  },
  maxRetries = 2
): Promise<{ json: T; rawText: string; tokenUsage?: unknown }> {
  let lastErrors: string[] | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const completion = await provider.completeJSON<T>(req);
    const validation = validateJson(req.jsonSchema, completion.json);
    if (validation.ok) {
      return completion;
    }
    lastErrors = validation.errors;
  }
  throw new Error(`LLM output invalid after ${maxRetries + 1} attempts: ${lastErrors?.join("; ")}`);
}
