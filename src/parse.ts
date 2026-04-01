import * as fs from "fs";
import { parseInterfaces } from "./parser/parseInterfaces";

function main() {
  const input = process.argv[2];

  if (!input) {
    console.error("Usage: node dist/parse.js <file>");
    console.error("       cat input.txt | node dist/parse.js -");
    process.exit(1);
  }

  const text = input === "-"
    ? fs.readFileSync(0, "utf-8")
    : fs.readFileSync(input, "utf-8");

  const result = parseInterfaces(text);
  console.log(JSON.stringify(result, null, 2));
}

main();
