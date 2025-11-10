import { useState, useEffect } from 'react';
import type { Stats } from '../types';
import { getPortNumName } from '../utils/portNames';
import { api } from '../api';

interface StatsDashboardProps {
  stats: Stats | null;
  loading: boolean;
  globalChannel?: string;
  globalDaysActive?: number;
}

export function StatsDashboard({ stats: initialStats, loading: initialLoading, globalChannel, globalDaysActive }: StatsDashboardProps) {
  const [stats, setStats] = useState<Stats | null>(initialStats);
  const [loading, setLoading] = useState(false); // Don't show loading on initial render

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
      </div>
    </div>
  );
}
