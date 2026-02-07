import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addDocumentToConfig, loadProjectConfig, type ProjectConfig } from "./config";

const tempRoots: string[] = [];

function createTempRoot(): string {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-config-"));
  tempRoots.push(rootPath);
  return rootPath;
}

function writeConfigFile(rootPath: string, contents: string): void {
  fs.writeFileSync(path.join(rootPath, "canonkeeper.json"), contents);
}

function writeConfigJson(rootPath: string, config: unknown): void {
  writeConfigFile(rootPath, `${JSON.stringify(config, null, 2)}\n`);
}

function expectedDefaults(rootPath: string): ProjectConfig {
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

afterEach(() => {
  for (const rootPath of tempRoots) {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe("loadProjectConfig", () => {
  it("returns defaults when canonkeeper.json is missing", () => {
    const rootPath = createTempRoot();
    const config = loadProjectConfig(rootPath);
    expect(config).toEqual(expectedDefaults(rootPath));
  });

  it("deep-merges partial nested config with defaults", () => {
    const rootPath = createTempRoot();
    writeConfigJson(rootPath, {
      projectName: "Draft Alpha",
      documents: [path.join("manuscripts", "chapter-1.md")],
      llm: {
        provider: "cloud",
        enabled: true,
        baseUrl: "https://llm.example.test/v1"
      },
      style: {
        repetitionThreshold: { sceneCount: 8 },
        toneBaselineScenes: 6
      }
    });

    const config = loadProjectConfig(rootPath);
    expect(config.projectName).toBe("Draft Alpha");
    expect(config.documents).toEqual([path.join("manuscripts", "chapter-1.md")]);
    expect(config.llm).toEqual({
      provider: "cloud",
      model: "gpt-5.2",
      enabled: true,
      baseUrl: "https://llm.example.test/v1"
    });
    expect(config.style).toEqual({
      stopwords: "default",
      repetitionThreshold: { projectCount: 12, sceneCount: 8 },
      toneBaselineScenes: 6
    });
  });

  it.each([
    { label: "empty file", contents: "" },
    { label: "malformed json", contents: "{ this is not valid json" },
    { label: "null json value", contents: "null" }
  ])("falls back to defaults for $label", ({ contents }) => {
    const rootPath = createTempRoot();
    writeConfigFile(rootPath, contents);

    const config = loadProjectConfig(rootPath);
    expect(config).toEqual(expectedDefaults(rootPath));
  });

  it("recursively merges nested objects instead of replacing them", () => {
    const rootPath = createTempRoot();
    writeConfigJson(rootPath, {
      style: {
        repetitionThreshold: { projectCount: 20 }
      }
    });

    const config = loadProjectConfig(rootPath);
    expect(config.style.repetitionThreshold).toEqual({
      projectCount: 20,
      sceneCount: 3
    });
    expect(config.style.toneBaselineScenes).toBe(10);
    expect(config.style.stopwords).toBe("default");
  });

  it("replaces arrays from defaults instead of attempting an element-wise merge", () => {
    const rootPath = createTempRoot();
    writeConfigJson(rootPath, {
      documents: ["drafts/one.md", "drafts/two.md"],
      style: {
        stopwords: ["the", "and", "a"]
      }
    });

    const config = loadProjectConfig(rootPath);
    expect(config.documents).toEqual(["drafts/one.md", "drafts/two.md"]);
    expect(config.style.stopwords).toEqual(["the", "and", "a"]);
    expect(config.style.repetitionThreshold).toEqual({ projectCount: 12, sceneCount: 3 });
    expect(config.style.toneBaselineScenes).toBe(10);
  });
});

describe("addDocumentToConfig", () => {
  it("stores document paths relative to root when file is inside the project", () => {
    const rootPath = createTempRoot();
    const filePath = path.join(rootPath, "manuscripts", "chapter-1.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "# Chapter 1\n");

    addDocumentToConfig(rootPath, filePath);
    addDocumentToConfig(rootPath, filePath);

    const config = loadProjectConfig(rootPath);
    expect(config.documents).toEqual([path.join("manuscripts", "chapter-1.md")]);
  });

  it("stores absolute paths when relative computation escapes the project root", () => {
    const rootPath = createTempRoot();
    const outsidePath = path.join(path.dirname(rootPath), "outside-scene.md");
    fs.writeFileSync(outsidePath, "outside");

    addDocumentToConfig(rootPath, outsidePath);

    const config = loadProjectConfig(rootPath);
    expect(config.documents).toEqual([outsidePath]);

    fs.rmSync(outsidePath, { force: true });
  });
});
