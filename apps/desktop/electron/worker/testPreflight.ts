export default async function testPreflight(): Promise<void> {
  const allowUnsupportedNode = process.env.CANONKEEPER_ALLOW_UNSUPPORTED_NODE === "1";
  const major = Number(process.versions.node.split(".")[0]);
  if (major !== 20 && !allowUnsupportedNode) {
    throw new Error(
      `CanonKeeper tests require Node 20. Detected Node ${process.versions.node}. Run \`mise exec node@20 -- pnpm test\` (or \`nvm use 20\`) before \`pnpm test\`.`
    );
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    db.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(
      `Failed to load better-sqlite3 during test preflight: ${message}. Run \`pnpm install\` or \`pnpm rebuild better-sqlite3\` with Node 20.`
    );
  }
}
