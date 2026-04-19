// --- PARSER TYPE DEFINITIONS ---
// These types represent the structured output of parsing Juniper router CLI output.
//
// CONTEXT — What IP Fabric does:
// IP Fabric connects to network devices (routers, switches) via SSH,
// runs commands like "show interfaces", and gets back UNSTRUCTURED TEXT output.
// The parser converts this text into STRUCTURED JSON that can be stored in a database.
//
// REAL-WORLD SIGNIFICANCE:
// Network engineers traditionally read this text output manually.
// IP Fabric automates this: parse → store → analyze → visualize.
// The company supports hundreds of vendors (Cisco, Juniper, Arista, Huawei, etc.)
// Each vendor has different output formats → different parsers needed.
// This parser handles JUNIPER's "show interfaces" command output.
//
// HIERARCHY:
// PhysicalInterface (e.g., ge-0/0/0 — a physical Ethernet port)
//   └── LogicalInterface (e.g., ge-0/0/0.0 — a VLAN on that port)
//         └── ProtocolEntry (e.g., inet — IPv4 running on that VLAN)
//
// NETWORKING CONCEPTS (for interview):
// - Physical interface: an actual port on the device (you can touch it)
// - Logical interface: a virtual subdivision of a physical port (VLANs)
// - Protocol: what network protocol runs on that interface (IPv4, IPv6, MPLS, etc.)

// ProtocolEntry: represents a network protocol running on a logical interface.
// In Java: public record ProtocolEntry(String type) {}
export interface ProtocolEntry {
  type: string;  // Protocol name: "inet" (IPv4), "inet6" (IPv6), "mpls", etc.
}

// LogicalInterface: a virtual interface on top of a physical port.
// Example: ge-0/0/0.0 = VLAN 0 on physical port ge-0/0/0
// A single physical port can have MULTIPLE logical interfaces (one per VLAN).
export interface LogicalInterface {
  name: string;                // e.g., "ge-0/0/0.0" — the ".0" is the unit number
  dscr?: string;               // Optional description set by the network engineer
                               // "?" makes it optional — not all interfaces have descriptions.
                               // In Java: @Nullable String description
  protocolList: ProtocolEntry[]; // List of protocols running on this interface
                                 // e.g., [{type: "inet"}, {type: "inet6"}] = IPv4 + IPv6
}

// PhysicalInterface: an actual physical port on the network device.
// Example: "ge-0/0/0" = Gigabit Ethernet, slot 0, PIC 0, port 0
// Naming convention: ge = Gigabit, xe = 10 Gigabit, et = 40/100 Gigabit
export interface PhysicalInterface {
  name: string;                      // e.g., "ge-0/0/0"
  state: { admin: string; link: string }; // Two states:
                                          //   admin: "enabled"/"disabled" — configured by engineer
                                          //   link: "up"/"down" — physical cable connection status
                                          // An interface can be admin=enabled but link=down (cable unplugged)
                                          // INLINE TYPE: { admin: string; link: string } defines an anonymous type
                                          // In Java you'd need a separate class: public record State(String admin, String link)
  dscr?: string;                     // Optional description
  speed: number;                     // Speed in bits per second. e.g., 1_000_000_000 = 1 Gbps
                                     // Stored in bps (not Mbps/Gbps) for consistent comparison
  duplex?: string;                   // Optional: "full" or "half". Full-duplex = send+receive simultaneously
  mac: string;                       // MAC address in Cisco dot notation: "5000.0026.0000"
                                     // Juniper uses colon notation: "50:00:00:26:00:00"
                                     // We convert to dot notation (industry standard for IP Fabric)
  logicalInterfaceList: LogicalInterface[];  // All logical interfaces on this physical port
}
