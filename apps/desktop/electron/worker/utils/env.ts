import fs from "node:fs";
import path from "node:path";

function parseEnv(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator < 1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value.replace(/\\n/g, "\n");
  }

  return parsed;
}

export function loadLocalEnv(rootPath?: string): void {
  const candidates = new Set<string>();
  const cwd = process.cwd();

  candidates.add(path.join(cwd, ".env.local"));
  candidates.add(path.join(cwd, ".env"));
  if (rootPath) {
    candidates.add(path.join(rootPath, ".env.local"));
    candidates.add(path.join(rootPath, ".env"));
  }

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    const parsed = parseEnv(fs.readFileSync(candidate, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}
