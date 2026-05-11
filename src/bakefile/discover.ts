import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BakefileNotFoundError } from "../shared/errors.ts";

export function discoverBakefile(): string {
  let current = process.cwd();

  while (true) {
    const bakefile = resolve(current, "Bakefile.ts");
    if (existsSync(bakefile)) {
      return bakefile;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new BakefileNotFoundError();
    }

    current = parent;
  }
}
