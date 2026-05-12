import { describe, expect, test } from "bun:test";
import {
  renderGlobalHelp,
  renderTaskHelp,
  renderTaskList,
  renderTaskNotFound,
} from "../../src/ui/help.ts";

describe("UI help rendering", () => {
  test("renderTaskList shows task names and descriptions", () => {
    const tasks = [
      { name: "build", fn: () => {}, options: { desc: "Build the project" } },
      { name: "test", fn: () => {}, options: { desc: "Run tests" } },
    ];
    const output = renderTaskList(tasks);
    expect(output).toContain("build");
    expect(output).toContain("Build the project");
    expect(output).toContain("test");
    expect(output).toContain("Run tests");
  });

  test("renderTaskList handles empty task list", () => {
    const output = renderTaskList([]);
    expect(output).toBe("No tasks found.");
  });

  test("renderGlobalHelp shows usage and commands", () => {
    const output = renderGlobalHelp();
    expect(output).toContain("Usage:");
    expect(output).toContain("init");
    expect(output).toContain("init --type");
    expect(output).toContain("list");
    expect(output).toContain("--help");
    expect(output).toContain("--dry-run");
  });

  test("renderTaskHelp shows task details", () => {
    const task = {
      name: "build",
      fn: () => {},
      options: {
        desc: "Build project",
        deps: ["setup"],
        inputs: ["src/**"],
        outputs: ["dist"],
        env: ["NODE_ENV"],
      },
    };
    const output = renderTaskHelp(task);
    expect(output).toContain("build");
    expect(output).toContain("Build project");
    expect(output).toContain("setup");
    expect(output).toContain("src/**");
    expect(output).toContain("dist");
    expect(output).toContain("NODE_ENV");
  });

  test("renderTaskNotFound suggests similar tasks", () => {
    const tasks = [
      { name: "build", fn: () => {}, options: {} },
      { name: "build-prod", fn: () => {}, options: {} },
      { name: "test", fn: () => {}, options: {} },
    ];
    const output = renderTaskNotFound("build-dev", tasks);
    expect(output).toContain("build-dev");
    expect(output).toContain("build-prod");
    expect(output).toContain("build");
  });

  test("renderTaskNotFound shows 'bake --help' when no suggestions", () => {
    const tasks = [
      { name: "build", fn: () => {}, options: {} },
      { name: "test", fn: () => {}, options: {} },
    ];
    const output = renderTaskNotFound("xyz", tasks);
    expect(output).toContain("Task not found: xyz");
    expect(output).toContain("bake --help");
    expect(output).not.toContain("bun bake");
  });
});

describe("renderGlobalHelp - completions / doctor の案内", () => {
  test("completions を含む", () => {
    expect(renderGlobalHelp()).toContain("completions");
  });

  test("doctor を含む", () => {
    expect(renderGlobalHelp()).toContain("doctor");
  });
});

describe("issue #21: renderTaskList グルーピング表示", () => {
  test("`:` を含まないタスクはフラット表示でグループヘッダーなし", () => {
    const tasks = [
      { name: "build", fn: () => {}, options: { desc: "ビルド" } },
      { name: "clean", fn: () => {}, options: {} },
    ];
    const output = renderTaskList(tasks);
    const lines = output.split("\n");
    expect(output).toContain("build");
    expect(output).toContain("clean");
    expect(lines.some((l) => l === "build:")).toBe(false);
  });

  test("`:` を含むタスクはグループヘッダーの下に表示される", () => {
    const tasks = [
      { name: "build:frontend", fn: () => {}, options: {} },
      { name: "build:backend", fn: () => {}, options: {} },
    ];
    const output = renderTaskList(tasks);
    const lines = output.split("\n");
    const headerIdx = lines.indexOf("build:");
    expect(headerIdx).toBeGreaterThan(-1);
    const frontendIdx = lines.findIndex((l) => l.includes("build:frontend"));
    const backendIdx = lines.findIndex((l) => l.includes("build:backend"));
    expect(headerIdx).toBeLessThan(frontendIdx);
    expect(headerIdx).toBeLessThan(backendIdx);
  });

  test("グループ内タスクは 2 スペースインデントで表示される", () => {
    const tasks = [
      { name: "lint:js", fn: () => {}, options: { desc: "js linter" } },
    ];
    const output = renderTaskList(tasks);
    const lines = output.split("\n");
    const jsLine = lines.find((l) => l.includes("lint:js"));
    expect(jsLine?.startsWith("  ")).toBe(true);
  });

  test("`:` なしと `:` ありタスクの混在で両方表示される", () => {
    const tasks = [
      { name: "clean", fn: () => {}, options: {} },
      { name: "build:frontend", fn: () => {}, options: {} },
      { name: "lint:js", fn: () => {}, options: {} },
    ];
    const output = renderTaskList(tasks);
    const lines = output.split("\n");
    expect(lines.some((l) => l === "build:")).toBe(true);
    expect(lines.some((l) => l === "lint:")).toBe(true);
    expect(output).toContain("clean");
  });

  test("グループ内タスクの desc が表示される", () => {
    const tasks = [
      {
        name: "build:frontend",
        fn: () => {},
        options: { desc: "フロントエンドビルド" },
      },
    ];
    const output = renderTaskList(tasks);
    expect(output).toContain("フロントエンドビルド");
  });

  test("platforms 情報が表示される", () => {
    const tasks = [
      {
        name: "open-finder",
        fn: () => {},
        options: {
          platforms: ["darwin"] as NodeJS.Platform[],
          desc: "Finder を開く",
        },
      },
      { name: "all-platforms", fn: () => {}, options: {} },
    ];
    const output = renderTaskList(tasks);
    expect(output).toContain("darwin only");
    expect(output).not.toMatch(/all-platforms.*only/);
  });
});
