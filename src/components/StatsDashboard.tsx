import { useState, useEffect } from 'react';
import type { Stats, TopGateway } from '../types';
import { getPortNumName } from '../utils/portNames';
import { api } from '../api';

interface StatsDashboardProps {
  stats: Stats | null;
  loading: boolean;
  globalChannel?: string;
  globalDaysActive?: number;
  onNodeClick?: (nodeId: string) => void;
}

export function StatsDashboard({ stats: initialStats, loading: initialLoading, globalChannel, globalDaysActive, onNodeClick }: StatsDashboardProps) {
  const [stats, setStats] = useState<Stats | null>(initialStats);
  const [loading, setLoading] = useState(false); // Don't show loading on initial render
  const [topGateways, setTopGateways] = useState<TopGateway[]>([]);
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
        const params: { limit?: number; since?: string; channel?: string } = {
          limit: 50,
        };
        
        // Calculate 'since' timestamp based on globalDaysActive
        if (globalDaysActive && globalDaysActive > 0) {
          const since = new Date();
          since.setDate(since.getDate() - globalDaysActive);
          params.since = since.toISOString();
        }
        
        if (globalChannel) {
          params.channel = globalChannel;
        }
        
        const data = await api.getTopGateways(params);
        setTopGateways(data.gateways);
      } catch (err) {
        console.error('Error fetching top gateways:', err);
        setTopGateways([]);
      } finally {
        setGatewaysLoading(false);
      }
    };

    fetchTopGateways();
  }, [globalChannel, globalDaysActive]);

  // Show initial loading state from parent
  if (initialLoading && !stats) {
    return <div className="loading">Loading statistics...</div>;
  }

  if (!stats) {
    return <div className="error">Failed to load statistics</div>;
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
          <h3>Top Gateways (50)</h3>
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
      </div>
    </div>
  );
}
