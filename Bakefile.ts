/// <reference path="./Bakefile.d.ts" />

task("clean", { desc: "dist ディレクトリを削除" }, async ({ rm }) => {
  await rm("dist", { recursive: true, force: true });
});

const buildOpts = ["build", "src/cli/main.ts", "--compile"];

const build = task(
  "build",
  {
    desc: "CLI をビルド",
    deps: ["clean"],
    inputs: ["src/**/*.ts", "test/**/*.test.ts"],
  },
  async ({ cmd }) => {
    await cmd("bun", [...buildOpts, "--outfile=dist/bake"]);
  },
);

const typecheck = task("typecheck", { desc: "型チェック" }, async ({ cmd }) => {
  await cmd("bunx", ["tsc", "--noEmit"]);
});

const fmt = task("fmt", { desc: "フォーマットチェック" }, async ({ cmd }) => {
  await cmd("bunx", ["biome", "check", "."]);
});

const test = task("test", { desc: "テストを実行" }, async ({ cmd }) => {
  await cmd("bun", ["test"]);
});

task.each(
  "sanity",
  {
    desc: "型チェック・フォーマット・ビルド・テストをまとめて実行",
    done: "✨ All checks passed! You're good to go.",
  },
  typecheck,
  fmt,
  build,
  test,
);

const server1 = task("server1", async ({ cmd }) => {
  await cmd("bun", ["run", "--hot", "scripts/dev-server.ts"], {
    env: { PORT: "3000" },
  });
});

const server2 = task("server2", async ({ cmd }) => {
  await cmd("bun", ["run", "--hot", "./dev-server.ts"], {
    env: { PORT: "3001" },
    cwd: "scripts/",
  });
});

task.compose("dev", { desc: "run servers" }, server1, server2);

task.default(build);
