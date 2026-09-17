import { describe, expect, test } from "bun:test";
import { renderDot, renderMermaid } from "../../src/ui/graph.ts";

describe("graph レンダリング", () => {
  const tasksWithDeps = [
    { name: "clean", fn: () => {}, options: {} },
    { name: "build", fn: () => {}, options: { deps: ["clean"] } },
    { name: "test", fn: () => {}, options: { deps: ["build"] } },
  ];

  const isolatedTasks = [
    { name: "lint", fn: () => {}, options: {} },
    { name: "format", fn: () => {}, options: {} },
  ];

  test("renderMermaid は flowchart LR で始まる", () => {
    const output = renderMermaid(tasksWithDeps);
    expect(output.startsWith("flowchart LR")).toBe(true);
  });

  test("renderMermaid は dep --> task の辺を出力する", () => {
    const output = renderMermaid(tasksWithDeps);
    expect(output).toContain("clean --> build");
    expect(output).toContain("build --> test");
  });

  test("renderMermaid は孤立ノードを個別に出力する", () => {
    const output = renderMermaid(isolatedTasks);
    expect(output).toContain("lint");
    expect(output).toContain("format");
  });

  test("renderDot は digraph bake { で始まる", () => {
    const output = renderDot(tasksWithDeps);
    expect(output.startsWith("digraph bake {")).toBe(true);
    expect(output.endsWith("}")).toBe(true);
  });

  test("renderDot はクォートされたエッジを出力する", () => {
    const output = renderDot(tasksWithDeps);
    expect(output).toContain('"clean" -> "build";');
    expect(output).toContain('"build" -> "test";');
  });

  test("renderDot は孤立ノードを個別に出力する", () => {
    const output = renderDot(isolatedTasks);
    expect(output).toContain('"lint";');
    expect(output).toContain('"format";');
  });

  test("renderMermaid: 特殊文字を含むノード名は安全にエスケープ", () => {
    const tasks = [
      { name: "ns:build", fn: () => {}, options: {} },
      { name: "ns:test", fn: () => {}, options: { deps: ["ns:build"] } },
    ];
    const output = renderMermaid(tasks);
    expect(output).toContain("ns_build");
    expect(output).toContain("ns_test");
  });

  const tasksWithEach = [
    { name: "typecheck", fn: () => {}, options: {} },
    { name: "fmt", fn: () => {}, options: {} },
    { name: "clean", fn: () => {}, options: {} },
    { name: "build", fn: () => {}, options: { deps: ["clean"] } },
    {
      name: "sanity",
      fn: () => {},
      options: {
        each: [
          { kind: "task" as const, name: "typecheck" },
          { kind: "task" as const, name: "fmt" },
          { kind: "task" as const, name: "build" },
          { kind: "command" as const, label: "bun test" },
        ],
      },
    },
  ];

  test("renderMermaid: task.each の工程を step --> task の辺として出力する", () => {
    const output = renderMermaid(tasksWithEach);
    expect(output).toContain("typecheck --> sanity");
    expect(output).toContain("fmt --> sanity");
    expect(output).toContain("build --> sanity");
    // コマンドタプルはラベルをノードにし、安全にエスケープする
    expect(output).toContain('bun_test["bun test"] --> sanity');
    // sanity は孤立ノード扱いされない
    expect(output).not.toMatch(/^ {2}sanity$/m);
  });

  test("renderDot: task.each の工程をクォートされた辺として出力する", () => {
    const output = renderDot(tasksWithEach);
    expect(output).toContain('"typecheck" -> "sanity";');
    expect(output).toContain('"fmt" -> "sanity";');
    expect(output).toContain('"build" -> "sanity";');
    expect(output).toContain('"bun test" -> "sanity";');
  });

  const tasksWithCompose = [
    { name: "ui", fn: () => {}, options: {} },
    { name: "api", fn: () => {}, options: {} },
    {
      name: "dev",
      fn: () => {},
      options: {
        compose: [["ui"], ["api"]],
      },
    },
  ];

  test("renderMermaid: task.compose の各ステージの各サービスを service --> task の辺として出力する", () => {
    const output = renderMermaid(tasksWithCompose);
    expect(output).toContain("ui --> dev");
    expect(output).toContain("api --> dev");
    // dev は孤立ノード扱いされない
    expect(output).not.toMatch(/^ {2}dev$/m);
  });

  test("renderDot: task.compose のサービスをクォートされた辺として出力する", () => {
    const output = renderDot(tasksWithCompose);
    expect(output).toContain('"ui" -> "dev";');
    expect(output).toContain('"api" -> "dev";');
  });

  test("renderMermaid: 同時起動グループ（1 ステージに複数サービス）も辺として出力する", () => {
    const tasks = [
      { name: "api", fn: () => {}, options: {} },
      { name: "worker", fn: () => {}, options: {} },
      {
        name: "dev",
        fn: () => {},
        options: { compose: [["api", "worker"]] },
      },
    ];
    const output = renderMermaid(tasks);
    expect(output).toContain("api --> dev");
    expect(output).toContain("worker --> dev");
  });

  test("deps と compose で同じ辺は一度だけ出力する", () => {
    const tasks = [
      { name: "a", fn: () => {}, options: {} },
      {
        name: "b",
        fn: () => {},
        options: {
          deps: ["a"],
          compose: [["a"]],
        },
      },
    ];
    const output = renderMermaid(tasks);
    const matches = output.match(/a --> b/g) ?? [];
    expect(matches.length).toBe(1);
  });

  describe("task.service の source", () => {
    test("source が task なら そのタスク --> サービス の辺を出力する", () => {
      const tasks = [
        { name: "poll", fn: () => {}, options: {} },
        {
          name: "poller",
          fn: () => {},
          options: {
            service: {
              run: () => {},
              source: { kind: "task" as const, name: "poll" },
            },
          },
        },
      ];
      const output = renderMermaid(tasks);
      expect(output).toContain("poll --> poller");
    });

    test("source が command なら コマンドラベル --> サービス の辺を出力する", () => {
      const tasks = [
        {
          name: "db",
          fn: () => {},
          options: {
            service: {
              run: () => {},
              source: {
                kind: "command" as const,
                label: "docker compose up postgres",
              },
            },
          },
        },
      ];
      const output = renderMermaid(tasks);
      expect(output).toMatch(
        /docker_compose_up_postgres\["docker compose up postgres"\] --> db/,
      );
    });

    test("source が fn なら辺を出力しない", () => {
      const tasks = [
        {
          name: "api",
          fn: () => {},
          options: {
            service: { run: () => {}, source: { kind: "fn" as const } },
          },
        },
      ];
      const output = renderMermaid(tasks);
      expect(output.split("\n")).toContain("  api");
    });
  });

  test("deps と each で同じ辺は一度だけ出力する", () => {
    const tasks = [
      { name: "a", fn: () => {}, options: {} },
      {
        name: "b",
        fn: () => {},
        options: { deps: ["a"], each: [{ kind: "task" as const, name: "a" }] },
      },
    ];
    const output = renderMermaid(tasks);
    const matches = output.match(/a --> b/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
