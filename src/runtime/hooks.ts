import type { TaskContext, TaskDefinition } from "../types.ts";

export async function runWithHooks(
  task: TaskDefinition,
  ctx: TaskContext,
): Promise<void> {
  if (task.isMeta) return;

  const hookCtx = { name: task.name };
  const { before, after } = task.options ?? {};

  if (before) {
    await before(hookCtx);
  }

  const start = performance.now();
  let ok = true;
  let fnError: unknown;

  try {
    await task.fn(ctx);
  } catch (err) {
    ok = false;
    fnError = err;
  }

  const durationMs = performance.now() - start;

  if (after) {
    await after({ ...hookCtx, ok, durationMs });
  }

  if (!ok) {
    throw fnError;
  }
}
