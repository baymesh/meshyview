export interface Node {
  id: string;
  node_id: number;
  long_name: string;
  short_name: string;
  hw_model: string;
  firmware: string | null;
  role: string;
  last_lat: number | null;
  last_long: number | null;
  channel: string;
  last_update: string;
}

export interface NodesResponse {
  nodes: Node[];
}

export interface Stats {
  nodes: number;
  packets: number;
  packet_seen_records: number;
  traceroutes: number;
  packets_by_portnum: Record<string, number>;
  nodes_by_role: Record<string, number>;
  nodes_by_hardware: Record<string, number>;
  nodes_by_channel: Record<string, number>;
}

export interface Edge {
  source: string;
  target: string;
  type: string;
  snr?: number;
  timestamp?: string;
}

export interface EdgesResponse {
  edges: Edge[];
}

export interface ChatMessage {
  id: number;
  from_node_id: number;
  to_node_id: number;
  channel: string;
  payload: string | { type: string; text?: string; reply_id?: number; emoji?: number | string; [key: string]: unknown };
  payload_hex?: string;
  portnum: number;
  import_time: string;
  gateway_count?: number;
}

export interface ChatResponse {
  packets: ChatMessage[];
}

export interface Packet {
  id: number;
  from_id?: string;
  to_id?: string;
  from_node_id?: number;
  to_node_id?: number;
  channel: string;
  portnum: number;
  timestamp?: string;
  import_time?: string;
  rx_time?: number;
  payload: string | { type: string; text?: string; [key: string]: unknown };
  payload_hex?: string;
  gateway_count?: number;
}

export interface TopGateway {
  node_id: number;
  packet_count: number;
  id: string;
  long_name: string;
  short_name: string;
  hw_model: string;
  role: string;
}

export interface TopGatewaysResponse {
  gateways: TopGateway[];
}

export interface NodeNeighbor {
  node_id: number;
  packet_count: number;
}

export interface NodeNeighborsResponse {
  node_id: number;
  heard_by: NodeNeighbor[];
  heard_from: NodeNeighbor[];
}
