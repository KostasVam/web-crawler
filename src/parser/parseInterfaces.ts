import { PhysicalInterface, LogicalInterface } from "./interfaces";

/**
 * Parse Juniper "show interfaces" output into structured data.
 */
export function parseInterfaces(text: string): PhysicalInterface[] {
  const result: PhysicalInterface[] = [];

  // Split into physical interface blocks
  const blocks = text.split(/^Physical interface: /m).filter((b) => b.trim());

  for (const block of blocks) {
    const iface = parsePhysicalBlock(block);
    if (iface) result.push(iface);
  }

  return result;
}

function parsePhysicalBlock(block: string): PhysicalInterface | null {
  // First line: "ge-0/0/0, Enabled, Physical link is Up"
  const headerMatch = block.match(
    /^(\S+),\s+(Enabled|Disabled),\s+Physical link is (\S+)/,
  );
  if (!headerMatch) return null;

  const name = headerMatch[1];
  const admin = headerMatch[2].toLowerCase();
  const link = headerMatch[3].toLowerCase();

  const speed = parseSpeed(block);
  const duplex = parseDuplex(block);
  const mac = parseMac(block);
  const dscr = parseDescription(block, /^ {2}Description: (.+)$/m);

  const logicalInterfaceList = parseLogicalInterfaces(block);

  const iface: PhysicalInterface = {
    name,
    state: { admin, link },
    speed,
    mac,
    logicalInterfaceList,
  };

  if (dscr) iface.dscr = dscr;
  if (duplex) iface.duplex = duplex;

  return iface;
}

function parseSpeed(block: string): number {
  const match = block.match(/Speed: (\d+)(mbps|Gbps|kbps)/i);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case "gbps":
      return value * 1_000_000_000;
    case "mbps":
      return value * 1_000_000;
    case "kbps":
      return value * 1_000;
    default:
      return value;
  }
}

function parseDuplex(block: string): string | undefined {
  const match = block.match(/Link-mode: ([A-Za-z-]+duplex)/);
  if (!match) return undefined;
  return match[1].replace("-duplex", "").toLowerCase();
}

function parseMac(block: string): string {
  const match = block.match(
    /Current address: ([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})/i,
  );
  if (!match) return "";
  return colonToDotNotation(match[1]);
}

/**
 * Convert "50:00:00:26:00:00" to "5000.0026.0000" (Cisco-style).
 */
function colonToDotNotation(mac: string): string {
  const hex = mac.replace(/:/g, "");
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`;
}

function parseDescription(
  block: string,
  pattern: RegExp,
): string | undefined {
  const match = block.match(pattern);
  return match ? match[1].trim() : undefined;
}

function parseLogicalInterfaces(block: string): LogicalInterface[] {
  const logicals: LogicalInterface[] = [];

  const logicalBlocks = block.split(
    /^ {2}Logical interface /m,
  );

  // Skip first chunk (physical interface header)
  for (let i = 1; i < logicalBlocks.length; i++) {
    const lb = logicalBlocks[i];
    const nameMatch = lb.match(/^(\S+)/);
    if (!nameMatch) continue;

    const name = nameMatch[1];
    const dscr = parseDescription(lb, /^ {4}Description: (.+)$/m);

    const protocolList: { type: string }[] = [];
    const protoMatches = lb.matchAll(/Protocol (\w+),/g);
    for (const pm of protoMatches) {
      protocolList.push({ type: pm[1] });
    }

    const logical: LogicalInterface = { name, protocolList };
    if (dscr) logical.dscr = dscr;
    logicals.push(logical);
  }

  return logicals;
}
