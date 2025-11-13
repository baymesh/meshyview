import type { NodesResponse, Stats, EdgesResponse, ChatResponse, TopGatewaysResponse, NodeNeighborsResponse, NodeGraphResponse } from './types';

const API_BASE_URL = 'https://meshql.bayme.sh';

// Custom error class for API errors
class ApiError extends Error {
  statusCode?: number;
  isNetworkError: boolean;
  
  constructor(
    message: string,
    statusCode?: number,
    isNetworkError: boolean = false
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.isNetworkError = isNetworkError;
  }
}

// Helper function to handle fetch errors with better messages
async function handleApiResponse<T>(response: Response, operation: string): Promise<T> {
  if (!response.ok) {
    let errorMessage = `Failed to ${operation}`;
    
    // Provide more specific error messages based on status code
    if (response.status === 404) {
      errorMessage = `${operation}: Not found`;
    } else if (response.status === 400) {
      errorMessage = `${operation}: Invalid request`;
    } else if (response.status === 429) {
      errorMessage = `${operation}: Too many requests. Please try again later`;
    } else if (response.status >= 500) {
      errorMessage = `${operation}: Server error. Please try again later`;
    } else if (response.status === 401 || response.status === 403) {
      errorMessage = `${operation}: Access denied`;
    } else {
      errorMessage = `${operation}: ${response.statusText}`;
    }
    
    throw new ApiError(errorMessage, response.status);
  }
  
  try {
    return await response.json();
  } catch (err) {
    throw new ApiError(`${operation}: Invalid response from server`, response.status);
  }
}

// Helper function to wrap fetch with network error handling
async function safeFetch(url: string, operation: string): Promise<Response> {
  try {
    const response = await fetch(url);
    return response;
  } catch (err) {
    // Network error (no connection, DNS failure, etc.)
    throw new ApiError(
      `${operation}: Unable to connect to server. Please check your internet connection`,
      undefined,
      true
    );
  }
}

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
    const response = await safeFetch(url, 'fetch nodes');
    return handleApiResponse<NodesResponse>(response, 'fetch nodes');
  },

  async getStats(params?: {
    channel?: string;
    days_active?: number;
  }): Promise<Stats> {
    const url = buildApiUrl('/api/stats', params);
    const response = await safeFetch(url, 'fetch stats');
    return handleApiResponse<Stats>(response, 'fetch stats');
  },

  async getEdges(params?: {
    since?: string;
    filter_type?: string;
    channel?: string;
  }): Promise<EdgesResponse> {
    const url = buildApiUrl('/api/edges', params);
    const response = await safeFetch(url, 'fetch edges');
    return handleApiResponse<EdgesResponse>(response, 'fetch edges');
  },

  async getChat(params?: {
    limit?: number;
    since?: string;
    channel?: string;
    decode_payload?: boolean;
  }): Promise<ChatResponse> {
    const url = buildApiUrl('/api/chat', params);
    const response = await safeFetch(url, 'fetch chat messages');
    return handleApiResponse<ChatResponse>(response, 'fetch chat messages');
  },

  async getPackets(params?: {
    limit?: number;
    since?: string;
    node_id?: string;
    gateway_id?: string;
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
    const response = await safeFetch(url, 'fetch packets');
    return handleApiResponse(response, 'fetch packets');
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
    hop_start?: number;
    hop_limit?: number;
    gateways?: Array<{
      node_id: number;
      node_name?: string;
      rx_rssi?: number;
      rx_snr?: number;
      hop_start?: number;
      hop_limit?: number;
      relay_node?: number;
    }>;
  }> {
    const url = buildApiUrl(`/api/packets/${packetId}`, params);
    const response = await safeFetch(url, 'fetch packet details');
    return handleApiResponse(response, 'fetch packet details');
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
    const response = await safeFetch(url, 'fetch traceroute');
    return handleApiResponse(response, 'fetch traceroute');
  },

  async getTopGateways(params?: {
    limit?: number;
    since?: string;
    channel?: string;
    direct_only?: boolean;
  }): Promise<TopGatewaysResponse> {
    const url = buildApiUrl('/api/gateways/top', params);
    const response = await safeFetch(url, 'fetch top gateways');
    return handleApiResponse<TopGatewaysResponse>(response, 'fetch top gateways');
  },

  async getNodeNeighbors(nodeId: number): Promise<NodeNeighborsResponse> {
    const url = `${API_BASE_URL}/api/nodes/${nodeId}/neighbors`;
    const response = await safeFetch(url, 'fetch node neighbors');
    return handleApiResponse<NodeNeighborsResponse>(response, 'fetch node neighbors');
  },

  async getNodeGraph(params?: {
    channel?: string;
    with_location?: boolean;
    hours?: number;
  }): Promise<NodeGraphResponse> {
    const url = buildApiUrl('/api/nodegraph', params);
    const response = await safeFetch(url, 'fetch node graph');
    return handleApiResponse<NodeGraphResponse>(response, 'fetch node graph');
  },
};
