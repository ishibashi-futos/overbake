import { existsSync, writeFileSync } from "node:fs";
import { BAKEFILE_DTS_TEMPLATE, BAKEFILE_TEMPLATE } from "./templates.ts";

export async function init(): Promise<void> {
  if (existsSync("Bakefile.ts") || existsSync("Bakefile.d.ts")) {
    throw new Error("Bakefile.ts or Bakefile.d.ts already exists");
  }

  writeFileSync("Bakefile.ts", BAKEFILE_TEMPLATE);
  writeFileSync("Bakefile.d.ts", BAKEFILE_DTS_TEMPLATE);
  console.log("Created Bakefile.ts and Bakefile.d.ts");
}
