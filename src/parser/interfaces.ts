export interface ProtocolEntry {
  type: string;
}

export interface LogicalInterface {
  name: string;
  dscr?: string;
  protocolList: ProtocolEntry[];
}

export interface PhysicalInterface {
  name: string;
  state: { admin: string; link: string };
  dscr?: string;
  speed: number;
  duplex?: string;
  mac: string;
  logicalInterfaceList: LogicalInterface[];
}
