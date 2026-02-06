import { createRequire } from "node:module";

const requireFromEsm = createRequire(import.meta.url);

export default async function testPreflight(): Promise<void> {
  const runtimeLabel = process.versions.bun
    ? `Bun ${process.versions.bun} (Node compat ${process.versions.node})`
    : `Node ${process.versions.node}`;

  try {
    const Database = requireFromEsm("better-sqlite3");
    const db = new Database(":memory:");
    db.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isAbiMismatch =
      message.includes("NODE_MODULE_VERSION") || message.includes("better_sqlite3.node");
    const recovery = isAbiMismatch
      ? "Reinstall native deps for your current runtime with `bun install` (or `npm rebuild better-sqlite3`)."
      : "Verify native toolchain and reinstall dependencies (`bun install`).";
    throw new Error(
      `Failed to load better-sqlite3 during test preflight on ${runtimeLabel}: ${message}. ${recovery}`
    );
  }
}
