import type { NodesResponse, Stats, EdgesResponse, ChatResponse, TopGatewaysResponse, NodeNeighborsResponse } from './types';

const API_BASE_URL = 'https://meshql.bayme.sh';

// Helper function to build API URLs with query parameters
function buildApiUrl(endpoint: string, params?: Record<string, unknown>): string {
  const url = `${API_BASE_URL}${endpoint}`;
  if (!params) return url;
  
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, value.toString());
    }
  });
  
  const queryString = searchParams.toString();
  return queryString ? `${url}?${queryString}` : url;
}

export const api = {
  async getNodes(params?: {
    role?: string;
    channel?: string;
    hw_model?: string;
    days_active?: number;
    hasLocation?: boolean;
    limit?: number;
  }): Promise<NodesResponse> {
    const url = buildApiUrl('/api/nodes', params);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch nodes: ${response.statusText}`);
    }
    return response.json();
  },

  async getStats(params?: {
    channel?: string;
    days_active?: number;
  }): Promise<Stats> {
    const url = buildApiUrl('/api/stats', params);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch stats: ${response.statusText}`);
    }
    return response.json();
  },

  async getEdges(params?: {
    since?: string;
    filter_type?: string;
    channel?: string;
  }): Promise<EdgesResponse> {
    const url = buildApiUrl('/api/edges', params);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch edges: ${response.statusText}`);
    }
    return response.json();
  },

  async getChat(params?: {
    limit?: number;
    since?: string;
    channel?: string;
    decode_payload?: boolean;
  }): Promise<ChatResponse> {
    const url = buildApiUrl('/api/chat', params);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch chat: ${response.statusText}`);
    }
    return response.json();
  },

  async getPackets(params?: {
    limit?: number;
    since?: string;
    node_id?: string;
    portnum?: number;
    channel?: string;
    decode_payload?: boolean;
    includeGatewayCount?: boolean;
    days_active?: number;
  }): Promise<{ packets: Array<{
    id: number;
    from_id?: string;
    to_id?: string;
    from_node_id?: number;
    to_node_id?: number;
    channel: string;
    portnum: number;
    timestamp?: string;
    import_time?: string;
    payload: string | { type: string; text?: string; [key: string]: unknown };
    payload_hex?: string;
    gateway_count?: number;
  }> }> {
    const url = buildApiUrl('/api/packets', params);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch packets: ${response.statusText}`);
    }
    return response.json();
  },

  async getPacketDetail(packetId: number, params?: {
    decode_payload?: boolean;
    includeGateways?: boolean;
    gatewayLimit?: number;
  }): Promise<{
    id: number;
    from_node_id: number;
    to_node_id: number;
    channel: string;
    portnum: number;
    import_time: string;
    payload: string | { type: string; [key: string]: unknown };
    payload_hex?: string;
    gateways?: Array<{
      node_id: number;
      node_name?: string;
      rssi?: number;
      snr?: number;
      relay_node?: number;
    }>;
  }> {
    const url = buildApiUrl(`/api/packets/${packetId}`, params);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch packet: ${response.statusText}`);
    }
    return response.json();
  },

  async getTracerouteDetail(packetId: number): Promise<{
    packet_id: number;
    traceroutes: Array<{
      id: number;
      packet_id: number;
      gateway_node_id: number;
      done: boolean;
      import_time: string;
      route: {
        type: string;
        route: number[];
        raw_hex?: string;
      };
      route_hex: string;
    }>;
  }> {
    const url = buildApiUrl(`/api/traceroutes/${packetId}`, { decode_payload: true });
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch traceroute: ${response.statusText}`);
    }
    return response.json();
  },

  async getTopGateways(params?: {
    limit?: number;
    since?: string;
    channel?: string;
  }): Promise<TopGatewaysResponse> {
    const url = buildApiUrl('/api/gateways/top', params);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch top gateways: ${response.statusText}`);
    }
    return response.json();
  },

  async getNodeNeighbors(nodeId: number): Promise<NodeNeighborsResponse> {
    const url = `${API_BASE_URL}/api/nodes/${nodeId}/neighbors`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch node neighbors: ${response.statusText}`);
    }
    return response.json();
  },
};
