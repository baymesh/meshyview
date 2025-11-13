import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import type { Packet } from '../types';
import { getPortNumName, formatLocalDateTime, getNodeDisplayName } from '../utils/portNames';
import type { NodeLookup } from '../utils/nodeLookup';
import { DEFAULT_PACKET_LIMIT, BROADCAST_NODE_ID } from '../utils/constants';
import { LoadingState, ErrorState } from './ui';

interface RecentPacketsProps {
  nodeLookup: NodeLookup | null;
  selectedChannel: string | null;
  daysActive: number;
  onPacketClick: (packetId: number) => void;
  onNodeClick: (nodeId: string) => void;
}

type SortField = 'timestamp' | 'gateways';
type SortDirection = 'asc' | 'desc';

export function RecentPackets({ 
  nodeLookup, 
  selectedChannel, 
  daysActive,
  onPacketClick,
  onNodeClick
}: RecentPacketsProps) {
  const [packets, setPackets] = useState<Packet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedPort, setSelectedPort] = useState<string>('all');

  useEffect(() => {
    const fetchPackets = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const params: {
          limit: number;
          decode_payload: boolean;
          includeGatewayCount: boolean;
          channel?: string;
          days_active?: number;
        } = {
          limit: DEFAULT_PACKET_LIMIT,
          decode_payload: false,
          includeGatewayCount: true,
        };

        if (selectedChannel) {
          params.channel = selectedChannel;
        }
        
        if (daysActive > 0) {
          params.days_active = daysActive;
        }

        const data = await api.getPackets(params);
        setPackets(data.packets || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch packets');
        console.error('Error fetching packets:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPackets();
  }, [selectedChannel, daysActive]);

  const getNodeName = (nodeId: number): string => {
    return getNodeDisplayName(nodeId, nodeLookup);
  };

  const handleNodeLinkClick = (nodeId: number) => {
    const hexId = `!${nodeId.toString(16).padStart(8, '0')}`;
    onNodeClick(hexId);
  };

  const isClickableNode = (nodeId: number): boolean => {
    return nodeId !== 0 && nodeId !== BROADCAST_NODE_ID;
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Toggle direction if clicking the same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Default to descending for new field
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedPackets = useMemo(() => {
    // First filter by port
    let filtered = packets;
    if (selectedPort !== 'all') {
      filtered = packets.filter(pkt => pkt.portnum.toString() === selectedPort);
    }
    
    const sorted = [...filtered];
    
    sorted.sort((a, b) => {
      let aValue: number;
      let bValue: number;

      if (sortField === 'gateways') {
        aValue = a.gateway_count ?? 0;
        bValue = b.gateway_count ?? 0;
      } else {
        // timestamp
        const aTime = a.timestamp || a.import_time || '';
        const bTime = b.timestamp || b.import_time || '';
        aValue = new Date(aTime).getTime();
        bValue = new Date(bTime).getTime();
      }

      if (sortDirection === 'asc') {
        return aValue - bValue;
      } else {
        return bValue - aValue;
      }
    });

    return sorted;
  }, [packets, sortField, sortDirection, selectedPort]);

  const uniquePorts = useMemo(() => {
    const ports = new Set(packets.map(pkt => pkt.portnum.toString()));
    return Array.from(ports).sort((a, b) => parseInt(a) - parseInt(b));
  }, [packets]);

  if (loading) {
    return (
      <div className="recent-packets">
        <LoadingState message="Loading packets..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="recent-packets">
        <ErrorState message={`Error: ${error}`} />
      </div>
    );
  }

  return (
    <div className="recent-packets">
      <div className="recent-packets-header">
        <h2>Recent Packets</h2>
        <div className="filter-info">
          {selectedChannel && <span>Channel: {selectedChannel}</span>}
        </div>
        <div className="packet-filters">
          <label>
            Port Filter:
            <select value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)}>
              <option value="all">All Ports</option>
              {uniquePorts.map(port => (
                <option key={port} value={port}>
                  {getPortNumName(port, false)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="packets-table-container">
        <table className="packets-table">
          <thead>
            <tr>
              <th>ID</th>
              <th 
                className="sortable"
                onClick={() => handleSort('timestamp')}
              >
                Timestamp {sortField === 'timestamp' && (sortDirection === 'asc' ? '↑' : '↓')}
              </th>
              <th>From</th>
              <th>To</th>
              <th>Port</th>
              <th>Channel</th>
              <th 
                className="sortable"
                onClick={() => handleSort('gateways')}
              >
                Gateways {sortField === 'gateways' && (sortDirection === 'asc' ? '↑' : '↓')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedPackets.map((pkt) => {
              const timestamp = pkt.timestamp || pkt.import_time || '';
              const fromNodeId = pkt.from_node_id || 0;
              const toNodeId = pkt.to_node_id || 0;
              
              return (
                <tr key={pkt.id}>
                  <td>
                    <button 
                      className="packet-id-link"
                      onClick={() => onPacketClick(pkt.id)}
                    >
                      {pkt.id}
                    </button>
                  </td>
                  <td>{formatLocalDateTime(timestamp)}</td>
                  <td>
                    {isClickableNode(fromNodeId) ? (
                      <button 
                        className="node-link"
                        onClick={() => handleNodeLinkClick(fromNodeId)}
                      >
                        {getNodeName(fromNodeId)}
                      </button>
                    ) : (
                      getNodeName(fromNodeId)
                    )}
                  </td>
                  <td>
                    {isClickableNode(toNodeId) ? (
                      <button 
                        className="node-link"
                        onClick={() => handleNodeLinkClick(toNodeId)}
                      >
                        {getNodeName(toNodeId)}
                      </button>
                    ) : (
                      getNodeName(toNodeId)
                    )}
                  </td>
                  <td>{getPortNumName(pkt.portnum.toString())}</td>
                  <td>{pkt.channel}</td>
                  <td>{pkt.gateway_count ?? '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {packets.length === 0 && (
          <div className="no-packets">No packets found</div>
        )}
      </div>
    </div>
  );
}
