// --- PARSER ENTRY POINT ---
// This is a separate CLI tool for running the parser standalone.
// Usage:
//   node dist/parse.js <file>          — parse a file
//   cat input.txt | node dist/parse.js - — parse from stdin (pipe)
//
// This is SEPARATE from the crawler (index.ts).
// The crawler fetches web pages. This tool parses Juniper CLI output.
// In a real IP Fabric system, the crawler would discover devices,
// connect via SSH, run "show interfaces", and feed the output to the parser.

// fs = Node.js filesystem module. Used to read files.
// "import * as fs" imports ALL exports from the "fs" module.
// Java equivalent: import java.nio.file.Files;
import * as fs from "fs";

// Import the parser function.
import { parseInterfaces } from "./parser/parseInterfaces";

function main() {
  // process.argv[2] is the FIRST user argument.
  // process.argv = ["node", "dist/parse.js", "<file>"]
  //                  [0]         [1]            [2]
  // Java: args[0] in main(String[] args) — Java doesn't include the program name.
  const input = process.argv[2];

  // If no argument provided, show usage and exit with error.
  if (!input) {
    // console.error() prints to STDERR (not STDOUT).
    // This way error messages don't mix with the JSON output.
    // Java: System.err.println(...)
    console.error("Usage: node dist/parse.js <file>");
    console.error("       cat input.txt | node dist/parse.js -");
    // process.exit(1) terminates immediately with exit code 1 (error).
    // Convention: 0 = success, non-zero = error.
    // Java: System.exit(1)
    process.exit(1);
  }

  // Read the input text.
  // Two modes:
  //   "-" = read from STDIN (allows piping: cat file.txt | node parse.js -)
  //   anything else = treat as a file path and read the file
  //
  // fs.readFileSync(0, "utf-8"): reads from file descriptor 0 (= STDIN).
  //   File descriptor 0 is always STDIN in Unix/Linux.
  //   "utf-8" = text encoding (how bytes become characters).
  //   "Sync" = blocking (waits until all input is read). This is fine for a CLI tool.
  //   In the crawler we used async I/O because we needed concurrency.
  //   Here it's a one-shot script, so blocking is simpler and fine.
  //
  // Java: Files.readString(Path.of(input)) or System.in for stdin
  const text = input === "-"
    ? fs.readFileSync(0, "utf-8")      // Read from STDIN (piped input)
    : fs.readFileSync(input, "utf-8"); // Read from file

  // Parse the text into structured data.
  const result = parseInterfaces(text);

  // Output as formatted JSON.
  // JSON.stringify(result, null, 2):
  //   result = the object to serialize
  //   null   = no custom replacer (serialize everything)
  //   2      = indent with 2 spaces (pretty-print)
  // Prints to STDOUT so it can be piped or redirected:
  //   node dist/parse.js input.txt > output.json
  // Java: System.out.println(objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(result));
  console.log(JSON.stringify(result, null, 2));
}

// Run the main function.
// Unlike index.ts, this is NOT async (no network I/O, no Promises).
// So we just call it directly — no .catch() needed.
// If it throws, Node.js will print the error and exit with code 1 automatically.
main();
