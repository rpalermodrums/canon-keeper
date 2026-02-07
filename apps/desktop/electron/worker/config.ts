import fs from "node:fs";
import path from "node:path";

export type ProjectConfig = {
  projectName: string;
  documents: string[];
  llm: {
    provider: "cloud" | "null";
    model: string;
    enabled: boolean;
    baseUrl?: string;
  };
  style: {
    stopwords: "default" | string[];
    repetitionThreshold: { projectCount: number; sceneCount: number };
    toneBaselineScenes: number;
  };
};

function defaultProjectConfig(rootPath: string): ProjectConfig {
  return {
    projectName: path.basename(rootPath),
    documents: [],
    llm: {
      provider: "null",
      model: "gpt-5.2",
      enabled: false,
      baseUrl: undefined
    },
    style: {
      stopwords: "default",
      repetitionThreshold: { projectCount: 12, sceneCount: 3 },
      toneBaselineScenes: 10
    }
  };
}

export function loadProjectConfig(rootPath: string): ProjectConfig {
  const configPath = path.join(rootPath, "canonkeeper.json");
  const defaults = defaultProjectConfig(rootPath);

  if (!fs.existsSync(configPath)) {
    return defaults;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<ProjectConfig>;
    return {
      ...defaults,
      ...raw,
      llm: { ...defaults.llm, ...(raw.llm ?? {}) },
      style: {
        ...defaults.style,
        ...(raw.style ?? {}),
        repetitionThreshold: {
          ...defaults.style.repetitionThreshold,
          ...(raw.style?.repetitionThreshold ?? {})
        }
      }
    };
  } catch {
    return defaults;
  }
}

export function saveProjectConfig(rootPath: string, config: ProjectConfig): void {
  const configPath = path.join(rootPath, "canonkeeper.json");
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function ensureProjectConfig(rootPath: string): ProjectConfig {
  const configPath = path.join(rootPath, "canonkeeper.json");
  const config = loadProjectConfig(rootPath);
  if (!fs.existsSync(configPath)) {
    saveProjectConfig(rootPath, config);
    return config;
  }
  try {
    JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    saveProjectConfig(rootPath, config);
  }
  return config;
}

export function resolveDocumentPath(rootPath: string, entry: string): string {
  if (path.isAbsolute(entry)) {
    return entry;
  }
  return path.join(rootPath, entry);
}

export function addDocumentToConfig(rootPath: string, filePath: string): void {
  const config = loadProjectConfig(rootPath);
  const relative = path.relative(rootPath, filePath);
  const stored =
    relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : filePath;

  if (!config.documents.includes(stored)) {
    config.documents = [...config.documents, stored];
    saveProjectConfig(rootPath, config);
  }
}
