/**
 * Pure boot decision logic — determines what action the app should take on startup.
 *
 * Extracted from the boot effect in useCanonkeeperApp for testability.
 */

import type { SessionEnvelope } from "./persistence";

export type ProjectSummaryLike = {
  id: string;
  root_path: string;
  name: string;
};

export type BootDecision =
  | { action: "adopt-current"; project: ProjectSummaryLike }
  | { action: "restore-last"; rootPath: string }
  | { action: "fresh-start" }
  | { action: "stale-root" };

/**
 * Decide boot strategy from worker state and persisted session.
 *
 * @param currentProject - Active project from the worker (null if none)
 * @param envelope - Persisted session envelope from localStorage
 */
export function decideBootAction(
  currentProject: ProjectSummaryLike | null,
  envelope: SessionEnvelope
): BootDecision {
  // Worker already has an active project (e.g. page refresh, HMR)
  if (currentProject) {
    return { action: "adopt-current", project: currentProject };
  }

  // No active project but we have a persisted root to try
  if (envelope.global.lastProjectRoot) {
    return { action: "restore-last", rootPath: envelope.global.lastProjectRoot };
  }

  // No project anywhere — fresh start
  return { action: "fresh-start" };
}
