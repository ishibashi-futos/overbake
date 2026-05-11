import type { TaskDefinition } from "../types.ts";

// `:` などの特殊文字を含む名前を mermaid のノード ID として安全にする
function mermaidNode(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return safe === name ? name : `${safe}["${name.replace(/"/g, "#quot;")}"]`;
}

// DOT 形式のノード名クォート（バックスラッシュと二重引用符をエスケープ）
function dotQuote(name: string): string {
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function renderMermaid(tasks: TaskDefinition[]): string {
  const lines = ["flowchart LR"];
  const nodesInEdges = new Set<string>();

  for (const task of tasks) {
    const deps = task.options?.deps ?? [];
    for (const dep of deps) {
      lines.push(`  ${mermaidNode(dep)} --> ${mermaidNode(task.name)}`);
      nodesInEdges.add(dep);
      nodesInEdges.add(task.name);
    }
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

  for (const task of tasks) {
    const deps = task.options?.deps ?? [];
    for (const dep of deps) {
      lines.push(`  ${dotQuote(dep)} -> ${dotQuote(task.name)};`);
      nodesInEdges.add(dep);
      nodesInEdges.add(task.name);
    }
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
