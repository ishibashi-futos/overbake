import { existsSync, readdirSync, statSync, watch } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TaskDefinition } from "../types.ts";

/** glob パターンから前の既存ディレクトリを探す */
function findFirstExistingDirectory(input: string, root: string): string {
  // 入力を root 基準の絶対パスに解決
  const fullPath = resolve(root, input);

  // glob メタ文字 *, ?, [ を検出
  const globChars = ["*", "?", "["];
  const hasGlobChar = globChars.some((char) => input.includes(char));

  if (hasGlobChar) {
    // glob を含む場合：最初の glob メタ文字の前のディレクトリを探す
    let lastGoodPath = root;
    const parts = fullPath.split("/");
    let currentPath = parts[0] === "" ? "/" : "";

    for (const part of parts) {
      if (part === "") continue;

      // glob メタ文字を含む部分に到達したら停止
      if (globChars.some((char) => part.includes(char))) {
        break;
      }

      const nextPath =
        currentPath === "/" ? `/${part}` : `${currentPath}/${part}`;

      // ディレクトリが存在すれば記録
      if (existsSync(nextPath)) {
        try {
          if (statSync(nextPath).isDirectory()) {
            currentPath = nextPath;
            lastGoodPath = nextPath;
          }
        } catch {
          // 存在しない or アクセス不可 -> 前のパスを返す
          break;
        }
      }
    }
    return lastGoodPath;
  } else {
    // glob を含まない場合：親ディレクトリを返す
    return dirname(fullPath);
  }
}

/** 解決済みタスクの inputs を Bakefile ルート基準の絶対パスに正規化し、重複除去して返す */
export function collectWatchPaths(
  tasks: TaskDefinition[],
  bakefilePath: string,
): string[] {
  const paths = tasks.flatMap((t) => t.options?.inputs ?? []);
  if (paths.length === 0) {
    return [bakefilePath];
  }

  const root = dirname(bakefilePath);
  const normalized = paths.map((p) => findFirstExistingDirectory(p, root));

  return [...new Set(normalized)];
}

/** 指定ディレクトリ配下の全サブディレクトリを列挙する */
function listAllDirectories(dir: string): string[] {
  const dirs: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const subdir = `${dir}/${entry.name}`;
        dirs.push(subdir);
        dirs.push(...listAllDirectories(subdir));
      }
    }
  } catch {
    // ディレクトリにアクセスできない場合は空の配列を返す
  }
  return dirs;
}

/**
 * 指定パスを監視し、変更時に debounce 付きで callback を呼ぶ。
 * ディレクトリ監視時はサブディレクトリも再帰的に監視する。
 * 返り値の関数を呼ぶと監視を停止する。
 */
export function startWatch(
  paths: string[],
  callback: () => Promise<void>,
  debounceMs = 100,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const watchers = new Map<string, ReturnType<typeof watch>>();

  const watchPath = (p: string) => {
    // 既に監視中なら何もしない
    if (watchers.has(p)) return;

    const watcher = watch(p, () => {
      // 親ディレクトリがディレクトリの場合、サブディレクトリ一覧を更新
      try {
        const stats = statSync(p);
        if (stats.isDirectory()) {
          const subdirs = listAllDirectories(p);
          for (const subdir of subdirs) {
            watchPath(subdir);
          }
        }
      } catch {
        // アクセス不可の場合はスキップ
      }

      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        callback().catch((err) =>
          console.error(err instanceof Error ? err.message : String(err)),
        );
      }, debounceMs);
    });

    watchers.set(p, watcher);

    // 初期時点でサブディレクトリを列挙して監視開始
    try {
      const stats = statSync(p);
      if (stats.isDirectory()) {
        const subdirs = listAllDirectories(p);
        for (const subdir of subdirs) {
          watchPath(subdir);
        }
      }
    } catch {
      // アクセス不可の場合はスキップ
    }
  };

  // 全ての監視パスに対して watchPath を実行
  for (const p of paths) {
    watchPath(p);
  }

  return () => {
    if (timer !== null) clearTimeout(timer);
    for (const w of watchers.values()) {
      w.close();
    }
  };
}
