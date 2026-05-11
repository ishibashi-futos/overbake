/// <reference path="./Bakefile.d.ts" />

task("clean", { desc: "dist ディレクトリを削除" }, async ({ rm }) => {
  await rm("dist", { recursive: true, force: true });
});

task(
  "build",
  {
    desc: "CLI をビルド",
    deps: ["clean"],
    inputs: ["src/**/*.ts", "test/**/*.test.ts"],
  },
  async ({ cmd }) => {
    await cmd("bun", [
      "build",
      "src/cli/main.ts",
      "--compile",
      "--outfile=dist/bake",
    ]);
  },
);
