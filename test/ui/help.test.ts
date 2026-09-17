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

  test("renderGlobalHelp shows daemon-related commands (ps/stop/logs)", () => {
    const output = renderGlobalHelp();
    expect(output).toContain("ps");
    expect(output).toContain("stop <task>");
    expect(output).toContain("stop --all");
    expect(output).toContain("logs <task>");
  });

  test("renderGlobalHelp shows -d, --daemon option", () => {
    const output = renderGlobalHelp();
    expect(output).toContain("-d, --daemon");
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

  test("renderTaskHelp shows Schedule for a cron task", () => {
    const task = {
      name: "backup",
      fn: () => {},
      options: {
        desc: "定期バックアップ",
        cron: { schedule: "@daily", steps: [] },
      },
    };
    const output = renderTaskHelp(task);
    expect(output).toContain("Schedule: @daily");
  });

  test("renderTaskHelp does not show Schedule for a non-cron task", () => {
    const task = {
      name: "build",
      fn: () => {},
      options: { desc: "Build project" },
    };
    const output = renderTaskHelp(task);
    expect(output).not.toContain("Schedule:");
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

  test("glaze を含む", () => {
    expect(renderGlobalHelp()).toContain("glaze");
  });
});

describe("renderGlobalHelp - bake docs", () => {
  test("Commands に docs 行を含む", () => {
    const output = renderGlobalHelp();
    expect(output).toContain(
      "docs                   Print the usage guide for AI agents (SKILL.md)",
    );
  });

  test("末尾にエージェント向けの導線として 'bake docs' を案内する", () => {
    const output = renderGlobalHelp();
    expect(output).toContain("bake docs");
    expect(output).toContain("SKILL.md");
  });
});

describe("renderTaskHelp - task.compose の Services 行", () => {
  test("compose があるときのみ Services を表示し、ステージは ' → '、グループ内は ', '", () => {
    const task = {
      name: "dev",
      fn: () => {},
      options: { compose: [["db"], ["api", "worker"], ["web"]] },
    };
    const output = renderTaskHelp(task);
    expect(output).toContain("Services: db → api, worker → web");
  });

  test("compose がないタスクには Services を表示しない", () => {
    const task = { name: "build", fn: () => {}, options: {} };
    const output = renderTaskHelp(task);
    expect(output).not.toContain("Services:");
  });
});

describe("renderTaskHelp - task.service の Ready / Fail on / Retry", () => {
  test("ready.port は host:port 表示（host 省略時は既定値）", () => {
    const task = {
      name: "db",
      fn: () => {},
      options: {
        service: {
          run: () => {},
          source: { kind: "fn" as const },
          ready: { port: 5432 },
        },
      },
    };
    const output = renderTaskHelp(task);
    expect(output).toContain("Ready: port localhost:5432");
  });

  test("ready.port に host を指定すればそれを表示する", () => {
    const task = {
      name: "db",
      fn: () => {},
      options: {
        service: {
          run: () => {},
          source: { kind: "fn" as const },
          ready: { port: 5432, host: "db.internal" },
        },
      },
    };
    const output = renderTaskHelp(task);
    expect(output).toContain("Ready: port db.internal:5432");
  });

  test("ready.log は describePattern 形式で表示する（文字列は JSON.stringify）", () => {
    const task = {
      name: "api",
      fn: () => {},
      options: {
        service: {
          run: () => {},
          source: { kind: "fn" as const },
          ready: { log: "listening" },
        },
      },
    };
    const output = renderTaskHelp(task);
    expect(output).toContain('Ready: log "listening"');
  });

  test("ready.log が RegExp なら String(regexp) 形式で表示する", () => {
    const task = {
      name: "api",
      fn: () => {},
      options: {
        service: {
          run: () => {},
          source: { kind: "fn" as const },
          ready: { log: /listening on/ },
        },
      },
    };
    const output = renderTaskHelp(task);
    expect(output).toContain("Ready: log /listening on/");
  });

  test("ready.check は 'check' とだけ表示する", () => {
    const task = {
      name: "web",
      fn: () => {},
      options: {
        service: {
          run: () => {},
          source: { kind: "fn" as const },
          ready: { check: async () => true },
        },
      },
    };
    const output = renderTaskHelp(task);
    expect(output).toContain("Ready: check");
  });

  test("ready.timeoutMs を指定すると末尾に timeout を添える", () => {
    const task = {
      name: "db",
      fn: () => {},
      options: {
        service: {
          run: () => {},
          source: { kind: "fn" as const },
          ready: { port: 5432, timeoutMs: 120_000 },
        },
      },
    };
    const output = renderTaskHelp(task);
    expect(output).toContain("Ready: port localhost:5432 (timeout 120000ms)");
  });

  test("ready 未指定なら Ready 行を表示しない", () => {
    const task = {
      name: "worker",
      fn: () => {},
      options: {
        service: { run: () => {}, source: { kind: "fn" as const } },
      },
    };
    const output = renderTaskHelp(task);
    expect(output).not.toContain("Ready:");
  });

  test("failOn を指定すると Fail on を表示する（describePattern 形式）", () => {
    const task = {
      name: "api",
      fn: () => {},
      options: {
        service: {
          run: () => {},
          source: { kind: "fn" as const },
          failOn: "EADDRINUSE",
        },
      },
    };
    const output = renderTaskHelp(task);
    expect(output).toContain('Fail on: "EADDRINUSE"');
  });

  test("failOn 未指定なら Fail on 行を表示しない", () => {
    const task = {
      name: "api",
      fn: () => {},
      options: {
        service: { run: () => {}, source: { kind: "fn" as const } },
      },
    };
    const output = renderTaskHelp(task);
    expect(output).not.toContain("Fail on:");
  });

  test("retry を指定すると '<attempts> attempts' を表示する", () => {
    const task = {
      name: "api",
      fn: () => {},
      options: {
        service: {
          run: () => {},
          source: { kind: "fn" as const },
          retry: { attempts: 3 },
        },
      },
    };
    const output = renderTaskHelp(task);
    expect(output).toContain("Retry: 3 attempts");
  });

  test("retry の delayMs/factor/maxDelayMs は指定されたものだけ添える", () => {
    const task = {
      name: "api",
      fn: () => {},
      options: {
        service: {
          run: () => {},
          source: { kind: "fn" as const },
          retry: { attempts: 5, delayMs: 1000, factor: 2 },
        },
      },
    };
    const output = renderTaskHelp(task);
    expect(output).toContain("Retry: 5 attempts (delayMs 1000ms, factor 2)");
    expect(output).not.toContain("maxDelayMs");
  });

  test("retry 未指定なら Retry 行を表示しない", () => {
    const task = {
      name: "api",
      fn: () => {},
      options: {
        service: { run: () => {}, source: { kind: "fn" as const } },
      },
    };
    const output = renderTaskHelp(task);
    expect(output).not.toContain("Retry:");
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

  test("cron タスクは (cron: <schedule>) が表示される（ungrouped）", () => {
    const tasks = [
      {
        name: "backup",
        fn: () => {},
        options: {
          desc: "定期バックアップ",
          cron: { schedule: "@daily", steps: [] },
        },
      },
      { name: "no-cron", fn: () => {}, options: {} },
    ];
    const output = renderTaskList(tasks);
    expect(output).toContain("cron: @daily");
    expect(output).not.toMatch(/no-cron.*cron:/);
  });

  test("cron タスクは (cron: <schedule>) が表示される（グループ表示）", () => {
    const tasks = [
      {
        name: "job:backup",
        fn: () => {},
        options: {
          desc: "定期バックアップ",
          cron: { schedule: "0 3 * * *", steps: [] },
        },
      },
    ];
    const output = renderTaskList(tasks);
    expect(output).toContain("cron: 0 3 * * *");
  });
});
