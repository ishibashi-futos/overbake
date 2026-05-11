import { discoverBakefile } from "../bakefile/discover.ts";
import { loadBakefile } from "../bakefile/loader.ts";
import { TaskRegistry } from "../bakefile/registry.ts";
import { resolveTasks } from "../graph/resolver.ts";

export async function runTask(taskName: string): Promise<void> {
  const bakefile = discoverBakefile();
  const registry = new TaskRegistry();

  await loadBakefile(bakefile, registry);

  const allTasks = registry.all();
  const resolved = resolveTasks(taskName, allTasks);

  for (const task of resolved) {
    console.log(`Running task: ${task.name}`);
    await task.fn();
  }
}
