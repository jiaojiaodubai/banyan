/**
 * Startup steps that must not take each other down.
 *
 * Plugin startup mixes steps with very different failure domains: registering
 * a menu, indexing the styles on disk, preparing optional editor assets,
 * starting the local server, initializing each main window. Before this helper
 * a single throw — a deleted asset, an unreadable file — aborted the rest of
 * startup, so the plugin looked half-broken (empty style list, menus without
 * labels) and the original error was the only clue. Each step now reports its
 * own failure and the remaining steps still run.
 */

export type StartupStep = {
  /** Stable, greppable name shown in the failure log and in diagnostics. */
  name: string;
  run: () => unknown;
};

export type StartupStepFailure = {
  name: string;
  error: unknown;
};

/**
 * Run `steps` in order, isolating every failure.
 *
 * @param onFailure Called once per failed step, before the next step runs.
 *     If it throws, the failure is still recorded and startup continues.
 * @returns The failures in step order; empty when everything succeeded.
 */
export async function runStartupSteps(
  steps: readonly StartupStep[],
  onFailure: (failure: StartupStepFailure) => void,
): Promise<StartupStepFailure[]> {
  const failures: StartupStepFailure[] = [];

  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      const failure: StartupStepFailure = { name: step.name, error };
      failures.push(failure);
      try {
        onFailure(failure);
      } catch {
        // Reporting must never be another way for startup to stop.
      }
    }
  }

  return failures;
}
