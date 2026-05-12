import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadBakefile } from "../../src/bakefile/loader.ts";
import { TaskRegistry } from "../../src/bakefile/registry.ts";
import { useTempDir } from "../support/sandbox.ts";

describe("loadBakefile", () => {
  const tmp = useTempDir("overbake-test");

  test("restores globalThis.task after successful import", async () => {
    const bakefilePath = resolve(tmp.path, "test-bakefile.ts");
    writeFileSync(bakefilePath, 'export default "test";');

    const registry = new TaskRegistry();

    const taskBeforeLoad = (globalThis as Record<string, unknown>).task;

    await loadBakefile(bakefilePath, registry);

    // loadBakefile should restore task to its original value after import
    expect((globalThis as Record<string, unknown>).task).toBe(taskBeforeLoad);
  });

  test("restores globalThis.task even if import fails", async () => {
    const bakefilePath = resolve(tmp.path, "broken-bakefile.ts");
    writeFileSync(bakefilePath, "throw new Error('import error');");

    const registry = new TaskRegistry();

    const taskBeforeLoad = (globalThis as Record<string, unknown>).task;

    try {
      await loadBakefile(bakefilePath, registry);
    } catch {
      // expected
    }

    // loadBakefile should restore task even on error
    expect((globalThis as Record<string, unknown>).task).toBe(taskBeforeLoad);
  });

  test("registers tasks via injected task function", async () => {
    const bakefilePath = resolve(tmp.path, "test-bakefile.ts");
    writeFileSync(
      bakefilePath,
      `task("mytask", { desc: "Test" }, () => {
        console.log("executed");
      });`,
    );

    const registry = new TaskRegistry();
    await loadBakefile(bakefilePath, registry);

    const task = registry.get("mytask");
    expect(task).toBeDefined();
    expect(task?.name).toBe("mytask");
    expect(task?.options?.desc).toBe("Test");
  });

  test("sets default task via task.default()", async () => {
    const bakefilePath = resolve(tmp.path, "test-bakefile.ts");
    writeFileSync(
      bakefilePath,
      `const build = task("build", () => {});
task.default(build);`,
    );

    const registry = new TaskRegistry();
    await loadBakefile(bakefilePath, registry);

    expect(registry.getDefault()).toBe("build");
  });

  test("throws DuplicateDefaultTaskError when default called twice", async () => {
    const bakefilePath = resolve(tmp.path, "test-bakefile.ts");
    writeFileSync(
      bakefilePath,
      `const build = task("build", () => {});
const clean = task("clean", () => {});
task.default(build);
task.default(clean);`,
    );

    const registry = new TaskRegistry();

    expect(async () => {
      await loadBakefile(bakefilePath, registry);
    }).toThrow();
  });

  test("registers a runEach task via task.each()", async () => {
    const bakefilePath = resolve(tmp.path, "test-bakefile.ts");
    writeFileSync(
      bakefilePath,
      `const a = task("a", () => {});
const b = task("b", () => {});
task.each("sanity", { desc: "まとめて検証" }, a, b);`,
    );

    const registry = new TaskRegistry();
    await loadBakefile(bakefilePath, registry);

    const sanity = registry.get("sanity");
    expect(sanity?.isMeta).toBe(false);
    expect(sanity?.options?.desc).toBe("まとめて検証");
    expect(sanity?.options?.each).toEqual([
      { kind: "task", name: "a", desc: undefined },
      { kind: "task", name: "b", desc: undefined },
    ]);
  });

  test("restores globalThis.task.default after successful import", async () => {
    const bakefilePath = resolve(tmp.path, "test-bakefile.ts");
    writeFileSync(bakefilePath, 'export default "test";');

    const registry = new TaskRegistry();

    const taskBeforeLoad = (globalThis as Record<string, unknown>).task;

    await loadBakefile(bakefilePath, registry);

    // task.default should be restored
    expect((globalThis as Record<string, unknown>).task).toBe(taskBeforeLoad);
  });
});
