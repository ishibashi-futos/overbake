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
});
