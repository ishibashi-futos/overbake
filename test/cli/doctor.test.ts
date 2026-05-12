import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { runDoctor } from "../../src/cli/doctor.ts";
import { useConsoleCapture, useTempDir } from "../support/sandbox.ts";

// issue #30: bake doctor（Bakefile 静的検証） - runDoctor
describe("bake doctor - runDoctor", () => {
  useTempDir("overbake-doctor", { chdir: true });
  const { logs } = useConsoleCapture();

  test("正常な Bakefile.ts では 0 errors, 0 warnings で exit code 0 を返す", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync("Bakefile.ts", `task("build", () => {});`);

    const code = await runDoctor();

    expect(code).toBe(0);
    const output = logs.join("\n");
    expect(output).toContain("0 errors");
    expect(output).toContain("0 warnings");
  });

  test("未定義 deps は ERROR として検出し exit code 2 を返す", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync(
      "Bakefile.ts",
      `task("build", { deps: ["undefined-dep"] }, () => {});`,
    );

    const code = await runDoctor();

    expect(code).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("ERROR");
    expect(output).toContain("undefined-dep");
  });

  test("循環依存は ERROR として検出し exit code 2 を返す", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync(
      "Bakefile.ts",
      `task("a", { deps: ["b"] }, () => {});
task("b", { deps: ["a"] }, () => {});`,
    );

    const code = await runDoctor();

    expect(code).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("ERROR");
    expect(output).toContain("循環依存");
  });

  test("重複タスク登録は ERROR として検出し exit code 2 を返す", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync(
      "Bakefile.ts",
      `task("build", () => {});
task("build", () => {});`,
    );

    const code = await runDoctor();

    expect(code).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("ERROR");
    expect(output).toContain("already defined");
  });

  test("メタタスクに outputs が指定されている場合は ERROR として検出し exit code 2 を返す", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync("Bakefile.ts", `task("meta-task", { outputs: ["dist"] });`);

    const code = await runDoctor();

    expect(code).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("ERROR");
    expect(output).toContain("meta-task");
    expect(output).toContain("outputs");
  });

  test("inputs glob が 0 件マッチの場合は WARN として検出し exit code 0 を返す", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync(
      "Bakefile.ts",
      `task("build", { inputs: ["nonexistent/**/*.ts"] }, () => {});`,
    );

    const code = await runDoctor();

    expect(code).toBe(0);
    const output = logs.join("\n");
    expect(output).toContain("WARN");
    expect(output).toContain("0 件");
    expect(output).toContain("0 errors");
  });

  test(".gitignore が無い場合は WARN として検出し exit code 0 を返す", async () => {
    writeFileSync("Bakefile.ts", `task("build", () => {});`);

    const code = await runDoctor();

    expect(code).toBe(0);
    const output = logs.join("\n");
    expect(output).toContain("WARN");
    expect(output).toContain(".gitignore");
    expect(output).toContain("0 errors");
  });

  test(".gitignore に .overbake/ が無い場合は WARN として検出し exit code 0 を返す", async () => {
    writeFileSync(".gitignore", "node_modules/\n");
    writeFileSync("Bakefile.ts", `task("build", () => {});`);

    const code = await runDoctor();

    expect(code).toBe(0);
    const output = logs.join("\n");
    expect(output).toContain("WARN");
    expect(output).toContain(".overbake/");
    expect(output).toContain("0 errors");
  });

  test("Bakefile.ts が無い場合は ERROR として検出し exit code 2 を返す", async () => {
    const code = await runDoctor();

    expect(code).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("ERROR");
  });

  test("error が複数ある場合も全件表示する", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync(
      "Bakefile.ts",
      `task("build", { deps: ["missing1"] }, () => {});
task("test", { deps: ["missing2"] }, () => {});`,
    );

    const code = await runDoctor();

    expect(code).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("missing1");
    expect(output).toContain("missing2");
  });

  test("wildcard を含む deps は未対応なので ERROR として検出し exit code 2 を返す", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync(
      "Bakefile.ts",
      `task("deploy", { deps: ["build:*"] }, () => {});`,
    );

    const code = await runDoctor();

    expect(code).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("ERROR");
    expect(output).toContain("build:*");
  });
});
