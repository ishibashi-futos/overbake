/// <reference path="./Bakefile.d.ts" />

task("clean", { desc: "dist ディレクトリを削除" }, async ({ rm }) => {
  await rm("dist", { recursive: true, force: true });
});

const buildOpts = ["build", "src/cli/main.ts", "--compile"];

task(
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

task.default("build");
