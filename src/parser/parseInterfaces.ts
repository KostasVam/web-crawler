// --- JUNIPER INTERFACE PARSER ---
// Parses the text output of Juniper's "show interfaces" command
// into structured PhysicalInterface objects.
//
// THIS IS WHAT IP FABRIC DOES IN PRODUCTION (for hundreds of vendors).
// You'd be writing parsers like this if you join the team.
//
// HOW IT WORKS:
//   1. Split the raw text into blocks (one per physical interface)
//   2. For each block, use REGEX to extract: name, state, speed, MAC, etc.
//   3. Within each block, find logical interfaces and their protocols
//   4. Return an array of structured objects
//
// WHY REGEX AND NOT A LIBRARY?
// Router CLI output is NOT a standard format (not XML, not JSON, not CSV).
// It's plain text designed for humans to read. Each vendor formats it differently.
// Regex is the most flexible tool for extracting data from unstructured text.
// Some companies use state machines for more complex formats, but regex works
// well for Juniper's relatively consistent output.

import { LogicalInterface, PhysicalInterface } from "./interfaces";

/**
 * Parse Juniper "show interfaces" output into structured data.
 *
 * MAIN ENTRY POINT for the parser.
 * Takes the entire text output and returns an array of PhysicalInterface objects.
 */
export function parseInterfaces(text: string): PhysicalInterface[] {
  const result: PhysicalInterface[] = [];

  // STEP 1: Split the text into blocks, one per physical interface.
  //
  // .split(/^Physical interface: /m) — explanation:
  //   /^Physical interface: /m is a REGULAR EXPRESSION (regex):
  //   ^          = start of a LINE (because of the "m" flag)
  //   Physical interface:  = literal text to match
  //   /m         = MULTILINE flag — makes ^ match start of each line, not just start of string
  //
  // The text looks like:
  //   Physical interface: ge-0/0/0, Enabled, ...
  //   <bunch of details>
  //   Physical interface: ge-0/0/1, Disabled, ...
  //   <bunch of details>
  //
  // .split() breaks it into: ["", "ge-0/0/0, Enabled...\n...", "ge-0/0/1, Disabled...\n..."]
  // .filter((b) => b.trim()) removes empty strings (the first element is always empty).
  //
  // Java equivalent: text.split("(?m)^Physical interface: ")
  // In Java, "(?m)" enables multiline mode (same as the /m flag in JS).
  const blocks = text.split(/^Physical interface: /m).filter((b) => b.trim());

  // Process each block into a PhysicalInterface object.
  for (const block of blocks) {
    const iface = parsePhysicalBlock(block);
    if (iface) result.push(iface);
    // iface is null if the block didn't match the expected format (malformed data).
  }

  return result;
}

// parsePhysicalBlock: parses a single physical interface block.
// Returns null if the block doesn't match the expected format.
// Return type "PhysicalInterface | null" = UNION TYPE.
// Java: @Nullable PhysicalInterface
function parsePhysicalBlock(block: string): PhysicalInterface | null {
  // REGEX for the first line of each block:
  //   "ge-0/0/0, Enabled, Physical link is Up"
  //
  // Let's break down the regex:
  //   ^         = start of string (this is the first line of the block)
  //   (\S+)     = capture group 1: one or more non-whitespace chars → interface name (e.g., "ge-0/0/0")
  //   ,\s+      = comma followed by whitespace
  //   (Enabled|Disabled) = capture group 2: admin state (must be one of these two)
  //   ,\s+Physical link is\s+
  //   (\S+)     = capture group 3: link state (e.g., "Up" or "Down")
  //
  // .match() returns an array: [fullMatch, group1, group2, group3] or null if no match.
  // Java: Pattern.compile("^(\\S+),\\s+(Enabled|Disabled),\\s+Physical link is (\\S+)").matcher(block)
  const headerMatch = block.match(
    /^(\S+),\s+(Enabled|Disabled),\s+Physical link is (\S+)/,
  );
  // If the header doesn't match, this isn't a valid interface block → skip it.
  if (!headerMatch) return null;

  // Extract values from regex capture groups.
  // headerMatch[0] = the full match (not used)
  // headerMatch[1] = interface name
  // headerMatch[2] = admin state ("Enabled" or "Disabled")
  // headerMatch[3] = link state ("Up" or "Down")
  // .toLowerCase() normalizes to lowercase for consistent output.
  const name = headerMatch[1];
  const admin = headerMatch[2].toLowerCase();   // "Enabled" → "enabled"
  const link = headerMatch[3].toLowerCase();     // "Up" → "up"

  // Extract other properties using helper functions (defined below).
  const speed = parseSpeed(block);
  const duplex = parseDuplex(block);
  const mac = parseMac(block);

  // The description regex: /^ {2}Description: (.+)$/m
  //   ^ {2}     = line starting with exactly 2 spaces (physical-level indentation)
  //   Description: = literal text
  //   (.+)      = capture group: everything after "Description: " until end of line
  //   $         = end of line
  //   /m        = multiline (^ and $ match line boundaries, not string boundaries)
  //
  // WHY 2 spaces? Juniper indentation convention:
  //   2 spaces = physical interface level
  //   4 spaces = logical interface level
  //   This distinguishes between a physical interface description and a logical one.
  const dscr = parseDescription(block, /^ {2}Description: (.+)$/m);

  // Parse all logical interfaces within this physical block.
  const logicalInterfaceList = parseLogicalInterfaces(block);

  // Build the PhysicalInterface object.
  // Note: we always include required fields, and conditionally add optional ones.
  const iface: PhysicalInterface = {
    name,                        // shorthand for name: name
    state: { admin, link },      // inline object with two properties
    speed,
    mac,
    logicalInterfaceList,
  };

  // Only add optional properties if they have values.
  // This keeps the JSON output clean — no "dscr: undefined" entries.
  // In Java: you'd always include the field, and it might be null.
  // In TypeScript: we can choose not to include the property at all.
  if (dscr) iface.dscr = dscr;
  if (duplex) iface.duplex = duplex;

  return iface;
}

// parseSpeed: extracts interface speed from the block.
// Input text contains a line like "Speed: 1000mbps" or "Speed: 10Gbps"
// Output: speed in BITS PER SECOND (bps).
// We normalize to bps so all speeds are comparable:
//   1000mbps → 1,000,000,000 bps
//   100mbps  → 100,000,000 bps
//   10Gbps   → 10,000,000,000 bps
function parseSpeed(block: string): number {
  // Regex: /Speed: (\d+)(mbps|Gbps|kbps)/i
  //   (\d+)       = capture group 1: the numeric value (e.g., "1000")
  //   (mbps|Gbps|kbps) = capture group 2: the unit
  //   /i          = case-INSENSITIVE flag (matches "Mbps", "MBPS", "mbps", etc.)
  const match = block.match(/Speed: (\d+)(mbps|Gbps|kbps)/i);
  if (!match) return 0;  // Speed not found → default to 0

  // parseInt(string, radix): parse string to integer.
  //   "1000" → 1000
  //   The "10" is the radix (base 10 = decimal). Always specify it!
  //   Without radix, parseInt("08") could be interpreted as octal in old JS.
  // Java: Integer.parseInt("1000")
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  // Convert to bits per second based on the unit.
  // The "_" in 1_000_000 is a NUMERIC SEPARATOR (like commas in English: 1,000,000).
  // It's purely visual — 1_000_000 === 1000000. Java has this too since Java 7.
  switch (unit) {
    case "gbps":
      return value * 1_000_000_000;    // Gigabits per second
    case "mbps":
      return value * 1_000_000;        // Megabits per second
    case "kbps":
      return value * 1_000;            // Kilobits per second
    default:
      return value;                    // Unknown unit, return raw value
  }
}

// parseDuplex: extracts duplex mode from the block.
// Duplex = whether the interface can send AND receive data at the same time.
//   Full-duplex: send + receive simultaneously (modern standard)
//   Half-duplex: send OR receive, not both (old hubs)
// Returns undefined if not found (optional in the output).
function parseDuplex(block: string): string | undefined {
  // Regex: /Link-mode: ([A-Za-z-]+duplex)/
  //   [A-Za-z-]+ = letters and hyphens (matches "Full-duplex", "Half-duplex")
  //   Must end with "duplex"
  const match = block.match(/Link-mode: ([A-Za-z-]+duplex)/);
  if (!match) return undefined;
  // "Full-duplex" → remove "-duplex" → "Full" → lowercase → "full"
  return match[1].replace("-duplex", "").toLowerCase();
}

// parseMac: extracts the MAC address from the block.
// MAC address = unique hardware identifier for the network interface.
// Every network card in the world has a unique MAC address.
//
// Juniper format (colon notation): "50:00:00:26:00:00"
// Cisco/IP Fabric format (dot notation): "5000.0026.0000"
// We convert from Juniper → Cisco format.
function parseMac(block: string): string {
  // Regex matches a MAC address in colon notation:
  //   [0-9a-f]{2}  = exactly 2 hex digits (00-ff)
  //   :            = colon separator
  //   Repeated 6 times: xx:xx:xx:xx:xx:xx
  //   /i           = case insensitive (handles uppercase hex like "5A:3F:...")
  const match = block.match(
    /Current address: ([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})/i,
  );
  if (!match) return "";
  // Convert from colon notation to dot notation.
  return colonToDotNotation(match[1]);
}

/**
 * Convert "50:00:00:26:00:00" to "5000.0026.0000" (Cisco-style).
 *
 * Step by step:
 *   "50:00:00:26:00:00"
 *   → remove colons → "500000260000"
 *   → split into 3 groups of 4: "5000" "0026" "0000"
 *   → join with dots: "5000.0026.0000"
 *
 * WHY THIS CONVERSION?
 * IP Fabric uses Cisco-style dot notation as the standard format.
 * Different vendors use different formats:
 *   Juniper: 50:00:00:26:00:00 (colon, groups of 2)
 *   Cisco:   5000.0026.0000    (dot, groups of 4)
 *   Linux:   50:00:00:26:00:00 (same as Juniper)
 * Converting to one standard format allows consistent searching/matching.
 */
function colonToDotNotation(mac: string): string {
  // .replace(/:/g, "") removes ALL colons.
  //   /:/  = regex matching ":"
  //   g    = GLOBAL flag — replace ALL occurrences, not just the first.
  //   Without "g", only the first colon would be removed!
  // Java: mac.replace(":", "") — Java's replace() already replaces all occurrences.
  const hex = mac.replace(/:/g, "");

  // .slice(start, end) extracts a substring (non-inclusive end).
  // Java: str.substring(0, 4)
  // hex = "500000260000"
  // hex.slice(0, 4)  = "5000"
  // hex.slice(4, 8)  = "0026"
  // hex.slice(8, 12) = "0000"
  // Template literal joins them with dots.
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`;
}

// parseDescription: generic helper to extract a description from a block.
// Takes a regex pattern as parameter so it can be reused for both
// physical-level (2-space indent) and logical-level (4-space indent) descriptions.
// Returns undefined if no match (the interface has no description).
function parseDescription(
  block: string,
  pattern: RegExp,   // RegExp = the type for regular expressions. Java: Pattern
): string | undefined {
  const match = block.match(pattern);
  // TERNARY OPERATOR: condition ? valueIfTrue : valueIfFalse
  // Same as Java's ternary. Short for: if (match) return match[1].trim(); else return undefined;
  // .trim() removes whitespace from both ends. Java: str.trim()
  return match ? match[1].trim() : undefined;
}

// parseLogicalInterfaces: extracts logical interfaces from a physical block.
// A physical interface can have 0 or more logical interfaces (VLANs).
//
// In the raw text, logical interfaces are indented with 2 spaces:
//   "  Logical interface ge-0/0/0.0"
//   "    Description: Management VLAN"
//   "    Protocol inet, MTU: 1500"
function parseLogicalInterfaces(block: string): LogicalInterface[] {
  const logicals: LogicalInterface[] = [];

  // Split by logical interface headers (2-space indentation).
  // /^ {2}Logical interface /m
  //   ^ {2}  = line starting with exactly 2 spaces
  //   /m     = multiline mode
  // This splits the block into chunks, one per logical interface.
  const logicalBlocks = block.split(
    /^ {2}Logical interface /m,
  );

  // Skip index 0 — that's the physical interface header (before any logical interface).
  // Start from index 1 — each element is a logical interface block.
  for (let i = 1; i < logicalBlocks.length; i++) {
    const lb = logicalBlocks[i];

    // First word of the block is the logical interface name (e.g., "ge-0/0/0.0").
    // /^(\S+)/ = capture non-whitespace characters at the start.
    const nameMatch = lb.match(/^(\S+)/);
    if (!nameMatch) continue;  // Skip if malformed. "continue" = next iteration.

    const name = nameMatch[1];

    // Extract description (4-space indent for logical level).
    // /^ {4}Description: (.+)$/m — 4 spaces because logical interface data
    // is indented further than physical interface data.
    const dscr = parseDescription(lb, /^ {4}Description: (.+)$/m);

    // Extract protocols using matchAll.
    // .matchAll(/Protocol (\w+),/g) finds ALL occurrences of "Protocol <word>,"
    //   (\w+) = capture group: word characters (letters, digits, underscore)
    //   /g    = global flag: find ALL matches, not just the first
    //   This returns an ITERATOR of matches (not an array).
    //
    // Example text: "Protocol inet, MTU: 1500\nProtocol inet6, MTU: 1500"
    //   → match 1: "inet"
    //   → match 2: "inet6"
    //
    // Java: Pattern.compile("Protocol (\\w+),").matcher(lb) + while(m.find())
    const protocolList: { type: string }[] = [];
    // "{ type: string }[]" = array of objects that have a "type" property.
    // This is an INLINE TYPE — we define the shape right here instead of referencing ProtocolEntry.
    // It's structurally identical to ProtocolEntry, so TypeScript considers them the same.

    const protoMatches = lb.matchAll(/Protocol (\w+),/g);
    // "for...of" works with iterators (matchAll returns an iterator, not an array).
    for (const pm of protoMatches) {
      // pm[0] = full match: "Protocol inet,"
      // pm[1] = capture group 1: "inet"
      protocolList.push({ type: pm[1] });
    }

    // Build the LogicalInterface object.
    const logical: LogicalInterface = { name, protocolList };
    // Add optional description only if it exists.
    if (dscr) logical.dscr = dscr;
    logicals.push(logical);
  }

  return logicals;
}
