import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { discoverBakefile } from "../bakefile/discover.ts";
import { loadBakefile } from "../bakefile/loader.ts";
import { TaskRegistry } from "../bakefile/registry.ts";
import { BakefileNotFoundError } from "../shared/errors.ts";
import type { TaskDefinition } from "../types.ts";

interface DoctorIssue {
  level: "error" | "warning";
  message: string;
}

// 循環依存を DFS で検出する（未定義 依存タスク はスキップ）
function detectCircularDeps(tasks: TaskDefinition[]): string[][] {
  const taskMap = new Map(tasks.map((t) => [t.name, t]));
  const cycles: string[][] = [];
  const seenKeys = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const done = new Set<string>();

  function dfs(name: string): void {
    if (done.has(name)) return;
    if (onStack.has(name)) {
      const idx = stack.indexOf(name);
      const cycle = [...stack.slice(idx), name];
      // 正規化（アルファベット順最小ノードを先頭に回転）して重複排除
      const members = cycle.slice(0, -1);
      const min = members.reduce((a, b) => (a < b ? a : b));
      const start = members.indexOf(min);
      const key = [...members.slice(start), ...members.slice(0, start)].join(
        ",",
      );
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        cycles.push(cycle);
      }
      return;
    }
    onStack.add(name);
    stack.push(name);
    const task = taskMap.get(name);
    if (task) {
      for (const dep of task.options?.deps ?? []) {
        // 存在しない 依存タスク はスキップ（未定義 依存タスク は別チェックで報告）
        if (taskMap.has(dep)) dfs(dep);
      }
    }
    stack.pop();
    onStack.delete(name);
    done.add(name);
  }

  for (const task of tasks) {
    dfs(task.name);
  }

  return cycles;
}

function renderReport(issues: DoctorIssue[]): void {
  if (issues.length > 0) {
    for (const issue of issues) {
      const label = issue.level === "error" ? "ERROR" : "WARN ";
      console.log(`  ${label}  ${issue.message}`);
    }
    console.log("");
  }
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  console.log(
    `${errors} error${errors !== 1 ? "s" : ""}, ${warnings} warning${warnings !== 1 ? "s" : ""}`,
  );
}

export async function runDoctor(): Promise<number> {
  const issues: DoctorIssue[] = [];

  // Bakefile.ts を探す
  let bakefilePath: string;
  try {
    bakefilePath = discoverBakefile();
  } catch (e) {
    if (e instanceof BakefileNotFoundError) {
      console.log("Checking Bakefile...\n");
      issues.push({ level: "error", message: "Bakefile.ts が見つかりません" });
      renderReport(issues);
      return 2;
    }
    throw e;
  }

  const root = dirname(bakefilePath);
  console.log(`Checking ${bakefilePath}...\n`);

  // Bakefile.ts をロードする（重複登録エラーも捕捉して error として記録）
  const registry = new TaskRegistry();
  try {
    await loadBakefile(bakefilePath, registry);
  } catch (e) {
    issues.push({
      level: "error",
      message:
        e instanceof Error
          ? e.message
          : `Bakefile.ts のロードに失敗しました: ${String(e)}`,
    });
    renderReport(issues);
    return 2;
  }

  const tasks = registry.all();
  const taskNames = new Set(tasks.map((t) => t.name));

  // 未定義 依存タスク チェック（ワイルドカード は未対応）
  for (const task of tasks) {
    for (const dep of task.options?.deps ?? []) {
      if (!taskNames.has(dep)) {
        issues.push({
          level: "error",
          message: `タスク '${task.name}' が未定義の依存タスク '${dep}' を参照しています`,
        });
      }
    }
  }

  // 循環依存チェック
  for (const cycle of detectCircularDeps(tasks)) {
    issues.push({
      level: "error",
      message: `循環依存: ${cycle.join(" -> ")}`,
    });
  }

  // メタタスク（fn なし: isMeta=true）なのに outputs が指定されている矛盾
  for (const task of tasks) {
    if (task.isMeta && (task.options?.outputs?.length ?? 0) > 0) {
      issues.push({
        level: "error",
        message: `メタタスク '${task.name}' は fn を持たないのに outputs が指定されています`,
      });
    }
  }

  // inputs glob が 0 件マッチ（warning）
  for (const task of tasks) {
    for (const pattern of task.options?.inputs ?? []) {
      let matched = false;
      for (const _ of new Bun.Glob(pattern).scanSync({ cwd: root })) {
        matched = true;
        break;
      }
      if (!matched) {
        issues.push({
          level: "warning",
          message: `タスク '${task.name}' の inputs glob '${pattern}' が 0 件にマッチしました`,
        });
      }
    }
  }

  // .gitignore に .overbake/ が含まれているか確認（warning）
  const gitignorePath = resolve(root, ".gitignore");
  if (!existsSync(gitignorePath)) {
    issues.push({
      level: "warning",
      message:
        ".gitignore が見つかりません（.overbake/ を追記することを推奨します）",
    });
  } else {
    const content = readFileSync(gitignorePath, "utf-8");
    const hasOverbake = content
      .split("\n")
      .some(
        (line) => line.trim() === ".overbake/" || line.trim() === ".overbake",
      );
    if (!hasOverbake) {
      issues.push({
        level: "warning",
        message: ".gitignore に .overbake/ が含まれていません",
      });
    }
  }

  renderReport(issues);
  const errorCount = issues.filter((i) => i.level === "error").length;
  return errorCount > 0 ? 2 : 0;
}
