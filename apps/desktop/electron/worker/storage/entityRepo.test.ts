import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addAlias, createEntity, createProject, listAliases, openDatabase } from "./index";

function setupDb() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "canonkeeper-"));
  const handle = openDatabase({ rootPath });
  const project = createProject(handle.db, rootPath, "Test Project");
  return { rootPath, db: handle.db, projectId: project.id };
}

describe("entity aliases", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("does not duplicate aliases with the same normalized value", () => {
    const setup = setupDb();
    tempRoots.push(setup.rootPath);
    const entity = createEntity(setup.db, {
      projectId: setup.projectId,
      type: "character",
      displayName: "Mira"
    });

    addAlias(setup.db, entity.id, "Mira");
    addAlias(setup.db, entity.id, "mira");
    addAlias(setup.db, entity.id, "  Mira  ");

    const aliases = listAliases(setup.db, entity.id);
    expect(aliases.filter((alias) => alias.toLowerCase() === "mira").length).toBe(1);
  });
});
