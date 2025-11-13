import { useState, useEffect } from 'react';
import type { Stats, TopGateway, Node } from '../types';
import { getPortNumName } from '../utils/portNames';
import { api } from '../api';
import { LoadingState, ErrorState } from './ui';
import type { NodeLookup } from '../utils/nodeLookup';

interface StatsDashboardProps {
  stats: Stats | null;
  loading: boolean;
  globalChannel?: string;
  globalDaysActive?: number;
  onNodeClick?: (nodeId: string) => void;
  nodeLookup?: NodeLookup;
}

interface ProcessedRelay {
  relay_byte: number;
  packet_count: number;
  potential_nodes: Node[];
}

export function StatsDashboard({ stats: initialStats, loading: initialLoading, globalChannel, globalDaysActive, onNodeClick, nodeLookup }: StatsDashboardProps) {
  const [stats, setStats] = useState<Stats | null>(initialStats);
  const [loading, setLoading] = useState(false); // Don't show loading on initial render
  const [topGateways, setTopGateways] = useState<TopGateway[]>([]);
  const [topDirectGateways, setTopDirectGateways] = useState<TopGateway[]>([]);
  const [topRelays, setTopRelays] = useState<ProcessedRelay[]>([]);
  const [gatewaysLoading, setGatewaysLoading] = useState(false);

  useEffect(() => {
    // Only update stats from parent if there's no global channel filter
    // Otherwise, the filtered stats from the other effect should be used
    if (!globalChannel) {
      setStats(initialStats);
    }
  }, [initialStats, globalChannel]);

  useEffect(() => {
    const fetchFilteredStats = async () => {
      if (!globalChannel && !globalDaysActive) {
        setStats(initialStats);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const params: { channel?: string; days_active?: number } = {};
        if (globalChannel) params.channel = globalChannel;
        if (globalDaysActive) params.days_active = globalDaysActive;
        
        const filteredStats = await api.getStats(params);
        setStats(filteredStats);
      } catch (err) {
        console.error('Error fetching filtered stats:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchFilteredStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalChannel, globalDaysActive]);

  useEffect(() => {
    const fetchTopGateways = async () => {
      try {
        setGatewaysLoading(true);
        
        // Calculate 'since' timestamp based on globalDaysActive
        const since = globalDaysActive && globalDaysActive > 0 
          ? new Date(Date.now() - globalDaysActive * 24 * 60 * 60 * 1000).toISOString()
          : undefined;
        
        const baseParams = {
          limit: 25,
          since,
          channel: globalChannel,
        };
        
        // Fetch all packets, direct-only gateways, and top relays
        const [allPacketsData, directOnlyData, relaysData] = await Promise.all([
          api.getTopGateways(baseParams),
          api.getTopGateways({ ...baseParams, direct_only: true }),
          api.getTopRelays({ ...baseParams, limit: 10 })
        ]);
        
        setTopGateways(allPacketsData.gateways);
        setTopDirectGateways(directOnlyData.gateways);
        console.log('Fetched relay nodes data:', relaysData);

        console.log('Node lookup available:', !!nodeLookup);

        // Process relay nodes - group by last byte and find matching nodes
        if (relaysData?.relay_nodes && nodeLookup) {
          const relayMap = new Map<number, { packet_count: number; node_ids: number[] }>();
          
          // Group relay nodes by their last byte
          relaysData.relay_nodes.forEach((relayNode) => {
            const lastByte = relayNode.node_id & 0xFF;
            if (!relayMap.has(lastByte)) {
              relayMap.set(lastByte, { packet_count: 0, node_ids: [] });
            }
            const entry = relayMap.get(lastByte)!;
            entry.packet_count += relayNode.packet_count;
            entry.node_ids.push(relayNode.node_id);
          });
          
          console.log('Processed relay map:', relayMap);
          const processedRelays: ProcessedRelay[] = Array.from(relayMap.entries())
            .map(([relay_byte, { packet_count }]) => {
              // Get all nodes on the same channel that match this last byte
              const allNodes = nodeLookup.getAllNodes();
              const matchingNodes = allNodes.filter(node => 
                globalChannel ? node.channel === globalChannel && (node.node_id & 0xFF) === relay_byte : (node.node_id & 0xFF) === relay_byte
              );
              
              return {
                relay_byte,
                packet_count,
                potential_nodes: matchingNodes
              };
            })
            .sort((a, b) => b.packet_count - a.packet_count)
            .slice(0, 10);
          
          setTopRelays(processedRelays);
        } else {
          setTopRelays([]);
        }
      } catch (err) {
        console.error('Error fetching top gateways and relays:', err);
        setTopGateways([]);
        setTopDirectGateways([]);
        setTopRelays([]);
      } finally {
        setGatewaysLoading(false);
      }
    };

    fetchTopGateways();
  }, [globalChannel, globalDaysActive, nodeLookup]);

  // Show initial loading state from parent
  if (initialLoading && !stats) {
    return <LoadingState message="Loading statistics..." />;
  }

  if (!stats) {
    return <ErrorState message="Failed to load statistics" />;
  }

  return (
    <div className="stats-dashboard">
      <div className="stats-header">
        <h2>Network Statistics</h2>
        {loading && <span className="loading-indicator">Loading...</span>}
      </div>
      
      <div className="stats-grid">
        <div className="stat-card">
          <h3>Overview</h3>
          <div className="stat-item">
            <span className="stat-label">Total Nodes:</span>
            <span className="stat-value">{stats.nodes.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Total Packets:</span>
            <span className="stat-value">{stats.packets.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Packet Seen Records:</span>
            <span className="stat-value">{stats.packet_seen_records.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Traceroutes:</span>
            <span className="stat-value">{stats.traceroutes.toLocaleString()}</span>
          </div>
        </div>

        <div className="stat-card">
          <h3>Nodes by Role</h3>
          {Object.entries(stats.nodes_by_role)
            .sort(([, a], [, b]) => b - a)
            .map(([role, count]) => (
              <div key={role} className="stat-item">
                <span className="stat-label">{role}:</span>
                <span className="stat-value">{count}</span>
              </div>
            ))}
        </div>

        <div className="stat-card">
          <h3>Top Hardware Models</h3>
          {Object.entries(stats.nodes_by_hardware)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([model, count]) => (
              <div key={model} className="stat-item">
                <span className="stat-label">{model}:</span>
                <span className="stat-value">{count}</span>
              </div>
            ))}
        </div>

        <div className="stat-card">
          <h3>Packet Types</h3>
          {Object.entries(stats.packets_by_portnum)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([portnum, count]) => (
              <div key={portnum} className="stat-item">
                <span className="stat-label">{getPortNumName(portnum)}:</span>
                <span className="stat-value">{count}</span>
              </div>
            ))}
        </div>

        <div className="stat-card stat-card-wide">
          <h3>Top Gateways (25)</h3>
          {gatewaysLoading ? (
            <div className="stat-loading">Loading...</div>
          ) : topGateways.length > 0 ? (
            <div className="gateways-table-container">
              <table className="gateways-list-table">
                <thead>
                  <tr>
                    <th className="rank-col">#</th>
                    <th className="name-col">Gateway</th>
                    <th className="hw-col">Hardware</th>
                    <th className="count-col">Packets</th>
                  </tr>
                </thead>
                <tbody>
                  {topGateways.map((gateway, index) => (
                    <tr key={gateway.node_id}>
                      <td className="rank-col">{index + 1}</td>
                      <td className="name-col">
                        {onNodeClick ? (
                          <button 
                            className="node-link"
                            onClick={() => onNodeClick(gateway.id)}
                          >
                            {gateway.long_name || gateway.short_name}
                          </button>
                        ) : (
                          <span>{gateway.long_name || gateway.short_name}</span>
                        )}
                      </td>
                      <td className="hw-col">{gateway.hw_model}</td>
                      <td className="count-col">{gateway.packet_count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="stat-item">
              <span className="stat-label">No data available</span>
            </div>
          )}
        </div>

        <div className="stat-card stat-card-wide">
          <h3>Top Direct Gateways (25)</h3>
          {gatewaysLoading ? (
            <div className="stat-loading">Loading...</div>
          ) : topDirectGateways.length > 0 ? (
            <div className="gateways-table-container">
              <table className="gateways-list-table">
                <thead>
                  <tr>
                    <th className="rank-col">#</th>
                    <th className="name-col">Gateway</th>
                    <th className="hw-col">Hardware</th>
                    <th className="count-col">Packets</th>
                  </tr>
                </thead>
                <tbody>
                  {topDirectGateways.map((gateway, index) => (
                    <tr key={gateway.node_id}>
                      <td className="rank-col">{index + 1}</td>
                      <td className="name-col">
                        {onNodeClick ? (
                          <button 
                            className="node-link"
                            onClick={() => onNodeClick(gateway.id)}
                          >
                            {gateway.long_name || gateway.short_name}
                          </button>
                        ) : (
                          <span>{gateway.long_name || gateway.short_name}</span>
                        )}
                      </td>
                      <td className="hw-col">{gateway.hw_model}</td>
                      <td className="count-col">{gateway.packet_count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="stat-item">
              <span className="stat-label">No data available</span>
            </div>
          )}
        </div>

        <div className="stat-card stat-card-four-wide">
          <h3>Top Relay Nodes (10)</h3>
          <p style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Relay nodes forward packets between devices. Each entry shows potential nodes matching the relay byte.
          </p>
          {gatewaysLoading ? (
            <div className="stat-loading">Loading...</div>
          ) : topRelays.length > 0 ? (
            <div className="relays-table-container">
              <table className="relays-list-table">
                <thead>
                  <tr>
                    <th className="rank-col">#</th>
                    <th className="byte-col">Relay Byte</th>
                    <th className="potential-nodes-col">Potential Relay Nodes</th>
                    <th className="count-col">Packets</th>
                  </tr>
                </thead>
                <tbody>
                  {topRelays.map((relay, index) => (
                    <tr key={relay.relay_byte}>
                      <td className="rank-col">{index + 1}</td>
                      <td className="byte-col">
                        <code>0x{relay.relay_byte.toString(16).padStart(2, '0').toUpperCase()}</code>
                      </td>
                      <td className="potential-nodes-col">
                        {relay.potential_nodes && relay.potential_nodes.length > 0 ? (
                          <div className="potential-nodes-list">
                            {relay.potential_nodes.map((node, nodeIdx) => (
                              <span key={node.node_id} className="potential-node-item">
                                {nodeIdx > 0 && <span className="node-separator"> or </span>}
                                {onNodeClick ? (
                                  <button 
                                    className="node-link"
                                    onClick={() => onNodeClick(node.id)}
                                    title={`${node.long_name} (${node.hw_model})`}
                                  >
                                    {node.long_name || node.short_name}
                                  </button>
                                ) : (
                                  <span title={`${node.long_name} (${node.hw_model})`}>
                                    {node.long_name || node.short_name}
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="no-matches">No matching nodes</span>
                        )}
                      </td>
                      <td className="count-col">{relay.packet_count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="stat-item">
              <span className="stat-label">No relay data available</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
