import { parseInterfaces } from "./parseInterfaces";

const sampleOutput = `
Physical interface: ge-0/0/0, Enabled, Physical link is Up
  Interface index: 138, SNMP ifIndex: 506, Generation: 141
  Description: STATIC1R16
  Link-level type: Ethernet, MTU: 1514, Link-mode: Full-duplex, Speed: 1000mbps, BPDU Error: None, MAC-REWRITE Error: None, Loopback: Disabled, Source filtering: Disabled, Flow control: Enabled,
  Auto-negotiation: Enabled, Remote fault: Online
  Device flags   : Present Running
  Interface flags: SNMP-Traps Internal: 0x4000
  Link flags     : None
  CoS queues     : 8 supported, 8 maximum usable queues
  Hold-times     : Up 0 ms, Down 0 ms
  Current address: 50:00:00:26:00:00, Hardware address: 50:00:00:26:00:00
  Last flapped   : 2018-10-12 07:55:25 UTC (1w6d 00:29 ago)
  Statistics last cleared: Never
  Traffic statistics:
   Input  bytes  :             79748352                  248 bps
   Output bytes  :            215993949                 1320 bps
   Input  packets:              1115931                    0 pps
   Output packets:              1591473                    0 pps

  Logical interface ge-0/0/0.0 (Index 73) (SNMP ifIndex 509) (Generation 138)
    Flags: SNMP-Traps 0x4000 Encapsulation: ENET2
    Protocol inet, MTU: 1500, Generation: 156, Route table: 0
      Flags: Sendbcast-pkt-to-re
      Addresses, Flags: Is-Preferred Is-Primary
        Destination: 10.241.80.0/31, Local: 10.241.80.1, Broadcast: Unspecified, Generation: 150
    Protocol iso, MTU: 1497, Generation: 157, Route table: 0
      Flags: None
    Protocol mpls, MTU: 1488, Maximum labels: 3, Generation: 158, Route table: 0

Physical interface: ae0, Enabled, Physical link is Up
  Interface index: 128, SNMP ifIndex: 526, Generation: 131
  Link-level type: Ethernet, MTU: 1514, Speed: 2Gbps, BPDU Error: None, MAC-REWRITE Error: None, Loopback: Disabled, Source filtering: Disabled, Flow control: Disabled, Minimum links needed: 1,
  Minimum bandwidth needed: 0
  Device flags   : Present Running
  Interface flags: SNMP-Traps Internal: 0x4000
  Current address: 4c:96:14:10:01:00, Hardware address: 4c:96:14:10:01:00
  Last flapped   : 2018-10-12 08:05:45 UTC (1w6d 00:19 ago)

  Logical interface ae0.0 (Index 72) (SNMP ifIndex 531) (Generation 137)
    Description: STATIC1R18
    Flags: SNMP-Traps 0x4000 Encapsulation: ENET2
    Protocol inet, MTU: 1500, Generation: 153, Route table: 0
      Flags: Sendbcast-pkt-to-re, Is-Primary
      Addresses, Flags: Is-Preferred Is-Primary
        Destination: 10.241.80.32/29, Local: 10.241.80.33, Broadcast: 10.241.80.39, Generation: 148
    Protocol iso, MTU: 1497, Generation: 154, Route table: 0
      Flags: Is-Primary
    Protocol mpls, MTU: 1488, Maximum labels: 3, Generation: 155, Route table: 0
      Flags: Is-Primary
`;

describe("parseInterfaces", () => {
  const result = parseInterfaces(sampleOutput);

  it("parses correct number of physical interfaces", () => {
    expect(result).toHaveLength(2);
  });

  describe("ge-0/0/0", () => {
    const iface = result[0];

    it("parses name", () => {
      expect(iface.name).toBe("ge-0/0/0");
    });

    it("parses state", () => {
      expect(iface.state).toEqual({ admin: "enabled", link: "up" });
    });

    it("parses description", () => {
      expect(iface.dscr).toBe("STATIC1R16");
    });

    it("parses speed in bps", () => {
      expect(iface.speed).toBe(1_000_000_000);
    });

    it("parses duplex", () => {
      expect(iface.duplex).toBe("full");
    });

    it("parses MAC in dot notation", () => {
      expect(iface.mac).toBe("5000.0026.0000");
    });

    it("parses logical interfaces", () => {
      expect(iface.logicalInterfaceList).toHaveLength(1);
      expect(iface.logicalInterfaceList[0].name).toBe("ge-0/0/0.0");
    });

    it("parses protocols", () => {
      expect(iface.logicalInterfaceList[0].protocolList).toEqual([
        { type: "inet" },
        { type: "iso" },
        { type: "mpls" },
      ]);
    });
  });

  describe("ae0", () => {
    const iface = result[1];

    it("parses name", () => {
      expect(iface.name).toBe("ae0");
    });

    it("parses speed (Gbps)", () => {
      expect(iface.speed).toBe(2_000_000_000);
    });

    it("parses MAC", () => {
      expect(iface.mac).toBe("4c96.1410.0100");
    });

    it("has no physical-level description", () => {
      expect(iface.dscr).toBeUndefined();
    });

    it("has no duplex (aggregate interface)", () => {
      expect(iface.duplex).toBeUndefined();
    });

    it("parses logical interface description", () => {
      expect(iface.logicalInterfaceList[0].dscr).toBe("STATIC1R18");
    });

    it("parses logical interface protocols", () => {
      expect(iface.logicalInterfaceList[0].protocolList).toEqual([
        { type: "inet" },
        { type: "iso" },
        { type: "mpls" },
      ]);
    });
  });

  it("matches the full expected result structure", () => {
    const expected = [
      {
        name: "ge-0/0/0",
        state: { admin: "enabled", link: "up" },
        dscr: "STATIC1R16",
        speed: 1000000000,
        duplex: "full",
        mac: "5000.0026.0000",
        logicalInterfaceList: [
          {
            name: "ge-0/0/0.0",
            protocolList: [
              { type: "inet" },
              { type: "iso" },
              { type: "mpls" },
            ],
          },
        ],
      },
      {
        name: "ae0",
        state: { admin: "enabled", link: "up" },
        speed: 2000000000,
        mac: "4c96.1410.0100",
        logicalInterfaceList: [
          {
            name: "ae0.0",
            dscr: "STATIC1R18",
            protocolList: [
              { type: "inet" },
              { type: "iso" },
              { type: "mpls" },
            ],
          },
        ],
      },
    ];

    expect(result).toEqual(expected);
  });
});
