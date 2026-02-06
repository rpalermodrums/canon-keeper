#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

/**
 * Ensure workspace-local node_modules links point at the root-installed package.
 * This avoids stale pnpm-style links lingering from previous toolchains.
 */
function ensureLink(workspaceName, packageName) {
  const workspaceNodeModules = path.join(root, workspaceName, 'node_modules');
  const rootPackage = path.join(root, 'node_modules', packageName);
  const linkPath = path.join(workspaceNodeModules, packageName);

  if (!fs.existsSync(rootPackage)) {
    console.warn(`[repair-links] Skipping ${packageName}: root package not found`);
    return;
  }

  fs.mkdirSync(workspaceNodeModules, { recursive: true });

  const relativeTarget = path.relative(workspaceNodeModules, rootPackage);
  let shouldRelink = false;

  if (!fs.existsSync(linkPath)) {
    shouldRelink = true;
  } else {
    const stat = fs.lstatSync(linkPath);
    if (!stat.isSymbolicLink()) {
      shouldRelink = true;
      fs.rmSync(linkPath, { recursive: true, force: true });
    } else {
      const existingTarget = fs.readlinkSync(linkPath);
      const resolvedExisting = path.resolve(workspaceNodeModules, existingTarget);
      const resolvedDesired = path.resolve(workspaceNodeModules, relativeTarget);
      if (resolvedExisting !== resolvedDesired) {
        shouldRelink = true;
        fs.unlinkSync(linkPath);
      }
    }
  }

  if (shouldRelink) {
    fs.symlinkSync(relativeTarget, linkPath, 'junction');
    console.log(`[repair-links] Linked ${workspaceName}/node_modules/${packageName} -> ${relativeTarget}`);
  }
}

ensureLink('apps/desktop', 'better-sqlite3');
