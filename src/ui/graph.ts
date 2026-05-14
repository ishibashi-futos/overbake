import type { ComposeStep, RunEachStep, TaskDefinition } from "../types.ts";

// `:` などの特殊文字を含む名前を mermaid のノード ID として安全にする
function mermaidNode(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return safe === name ? name : `${safe}["${name.replace(/"/g, "#quot;")}"]`;
}

// DOT 形式のノード名クォート（バックスラッシュと二重引用符をエスケープ）
function dotQuote(name: string): string {
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// task.each / task.compose の工程記述からエッジ始点となるノード名を取り出す。
// 構造が同形なのでどちらの step 型にも適用できる。
function stepNode(step: RunEachStep | ComposeStep): string {
  return step.kind === "task" ? step.name : step.label;
}

interface Edge {
  from: string;
  to: string;
}

// 各タスクの「自分に向かう辺」（deps、task.each、task.compose の工程）を重複なく列挙する
function incomingEdges(tasks: TaskDefinition[]): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const add = (from: string, to: string) => {
    const key = JSON.stringify([from, to]);
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to });
  };
  for (const task of tasks) {
    for (const dep of task.options?.deps ?? []) add(dep, task.name);
    for (const step of task.options?.each ?? []) add(stepNode(step), task.name);
    for (const step of task.options?.compose ?? [])
      add(stepNode(step), task.name);
  }
  return edges;
}

export function renderMermaid(tasks: TaskDefinition[]): string {
  const lines = ["flowchart LR"];
  const nodesInEdges = new Set<string>();

  for (const { from, to } of incomingEdges(tasks)) {
    lines.push(`  ${mermaidNode(from)} --> ${mermaidNode(to)}`);
    nodesInEdges.add(from);
    nodesInEdges.add(to);
  }

  // 依存辺に現れない孤立ノードを個別に追加
  for (const task of tasks) {
    if (!nodesInEdges.has(task.name)) {
      lines.push(`  ${mermaidNode(task.name)}`);
    }
  }

  return lines.join("\n");
}

export function renderDot(tasks: TaskDefinition[]): string {
  const lines = ["digraph bake {"];
  const nodesInEdges = new Set<string>();

  for (const { from, to } of incomingEdges(tasks)) {
    lines.push(`  ${dotQuote(from)} -> ${dotQuote(to)};`);
    nodesInEdges.add(from);
    nodesInEdges.add(to);
  }

  // 依存辺に現れない孤立ノードを個別に追加
  for (const task of tasks) {
    if (!nodesInEdges.has(task.name)) {
      lines.push(`  ${dotQuote(task.name)};`);
    }
  }

  lines.push("}");
  return lines.join("\n");
}

export function renderGraph(
  tasks: TaskDefinition[],
  format: "mermaid" | "dot",
): string {
  return format === "dot" ? renderDot(tasks) : renderMermaid(tasks);
}
