import { dirname } from "node:path";
import { discoverBakefile } from "../bakefile/discover.ts";
import { loadBakefile } from "../bakefile/loader.ts";
import { TaskRegistry } from "../bakefile/registry.ts";
import { resolveTasks } from "../graph/resolver.ts";
import { createTaskContext } from "./context.ts";

export { createTaskContext } from "./context.ts";

export async function runTask(taskName: string): Promise<void> {
  const cwd = process.cwd();
  const bakefile = discoverBakefile();
  const root = dirname(bakefile);
  const registry = new TaskRegistry();

  await loadBakefile(bakefile, registry);

  const allTasks = registry.all();
  const resolved = resolveTasks(taskName, allTasks);

  for (const task of resolved) {
    const ctx = createTaskContext({ name: task.name, root, cwd });
    console.log(`Running task: ${task.name}`);
    await task.fn(ctx);
  }
}
