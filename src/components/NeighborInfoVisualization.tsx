import { useMemo } from 'react';
import type { NodeLookup } from '../utils/nodeLookup';
import { formatNodeId, getNodeDisplayName } from '../utils/portNames';

interface Neighbor {
  node_id: number;
  snr?: number;
}

interface NeighborInfoVisualizationProps {
  neighbors: Neighbor[];
  sourceNodeId: number;
  nodeLookup: NodeLookup | null;
  onNodeClick: (nodeId: string) => void;
  channel?: string;
}

// SNR thresholds by channel preset
const SNR_THRESHOLDS: Record<string, { excellent: number; good: number; fair: number; marginal: number }> = {
  'ShortTurbo': { excellent: 8, good: 3, fair: -2, marginal: -7.5 },
  'ShortFast': { excellent: 8, good: 3, fair: -2, marginal: -7.5 },
  'ShortSlow': { excellent: 8, good: 2, fair: -3, marginal: -10 },
  'MediumFast': { excellent: 8, good: 3, fair: -4, marginal: -12.5 },
  'MediumSlow': { excellent: 8, good: 3, fair: -5, marginal: -15 },
  'LongFast': { excellent: 6, good: 1, fair: -6, marginal: -17.5 },
  'LongModerate': { excellent: 6, good: 1, fair: -7, marginal: -19 },
  'LongSlow': { excellent: 5, good: 0, fair: -8, marginal: -20 },
  // Default fallback
  'default': { excellent: 8, good: 3, fair: -4, marginal: -12.5 }
};

export function NeighborInfoVisualization({ 
  neighbors, 
  sourceNodeId, 
  nodeLookup,
  onNodeClick,
  channel 
}: NeighborInfoVisualizationProps) {
  const getNodeName = (nodeId: number): string => {
    return getNodeDisplayName(nodeId, nodeLookup);
  };

  const sortedNeighbors = useMemo(() => {
    return [...neighbors].sort((a, b) => (b.snr ?? -999) - (a.snr ?? -999));
  }, [neighbors]);

  const snrStats = useMemo(() => {
    if (neighbors.length === 0) return null;
    
    const snrValues = neighbors.map(n => n.snr).filter((snr): snr is number => snr !== undefined);
    if (snrValues.length === 0) return null;
    
    const min = Math.min(...snrValues);
    const max = Math.max(...snrValues);
    const avg = snrValues.reduce((sum, val) => sum + val, 0) / snrValues.length;
    
    return { min, max, avg };
  }, [neighbors]);

  const thresholds = SNR_THRESHOLDS[channel || 'default'] || SNR_THRESHOLDS.default;

  const getSignalQuality = (snr: number | undefined): { label: string; color: string } => {
    if (snr === undefined) return { label: 'Unknown', color: '#6b7280' };
    
    if (snr >= thresholds.excellent) return { label: 'Excellent', color: '#22c55e' };
    if (snr >= thresholds.good) return { label: 'Good', color: '#84cc16' };
    if (snr >= thresholds.fair) return { label: 'Fair', color: '#eab308' };
    if (snr >= thresholds.marginal) return { label: 'Marginal', color: '#f97316' };
    return { label: 'Poor', color: '#ef4444' };
  };

  // Calculate distance between two points using Haversine formula
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const getDistance = (neighborNodeId: number): number | null => {
    if (!nodeLookup) return null;
    
    const sourceNode = nodeLookup.getNode(sourceNodeId);
    const neighborNode = nodeLookup.getNode(neighborNodeId);
    
    if (!sourceNode || !neighborNode) return null;
    
    const sourceLat = sourceNode.last_lat;
    const sourceLon = sourceNode.last_long;
    const neighborLat = neighborNode.last_lat;
    const neighborLon = neighborNode.last_long;
    
    if (!sourceLat || !sourceLon || !neighborLat || !neighborLon) return null;
    if (sourceLat === 0 || sourceLon === 0 || neighborLat === 0 || neighborLon === 0) return null;
    
    // Convert from integer coordinates to decimal degrees (Meshtastic stores coords * 10^7)
    const sourceLatDeg = sourceLat / 10000000;
    const sourceLonDeg = sourceLon / 10000000;
    const neighborLatDeg = neighborLat / 10000000;
    const neighborLonDeg = neighborLon / 10000000;
    
    return calculateDistance(sourceLatDeg, sourceLonDeg, neighborLatDeg, neighborLonDeg);
  };

  if (neighbors.length === 0) {
    return (
      <div className="neighbor-info-visualization">
        <h3>Neighbor Information</h3>
        <p className="no-neighbors">No neighbors reported</p>
      </div>
    );
  }

  return (
    <div className="neighbor-info-visualization">
      <div className="neighbor-info-header">
        <h3>Neighbor Information</h3>
        <div className="neighbor-stats">
          <span className="stat-item">
            <strong>{neighbors.length}</strong> neighbors
          </span>
          {snrStats && (
            <>
              <span className="stat-item">
                Avg SNR: <strong>{snrStats.avg.toFixed(1)} dB</strong>
              </span>
              <span className="stat-item">
                Range: <strong>{snrStats.min.toFixed(1)} → {snrStats.max.toFixed(1)} dB</strong>
              </span>
            </>
          )}
        </div>
      </div>

      <div className="neighbor-source">
        <span>Reporting Node: </span>
        <button 
          className="node-link"
          onClick={() => onNodeClick(formatNodeId(sourceNodeId))}
        >
          {getNodeName(sourceNodeId)}
        </button>
      </div>

      <div className="neighbors-table">
        <table>
          <thead>
            <tr>
              <th>Neighbor</th>
              <th>SNR (dB)</th>
              <th>Quality</th>
              <th>Distance</th>
            </tr>
          </thead>
          <tbody>
            {sortedNeighbors.map((neighbor) => {
              const quality = getSignalQuality(neighbor.snr);
              const distance = getDistance(neighbor.node_id);
              
              return (
                <tr key={neighbor.node_id}>
                  <td>
                    <button 
                      className="node-link"
                      onClick={() => onNodeClick(formatNodeId(neighbor.node_id))}
                    >
                      {getNodeName(neighbor.node_id)}
                    </button>
                  </td>
                  <td className="snr-value">
                    {neighbor.snr !== undefined ? neighbor.snr.toFixed(1) : 'N/A'}
                  </td>
                  <td>
                    <span 
                      className="quality-badge"
                      style={{ backgroundColor: quality.color }}
                    >
                      {quality.label}
                    </span>
                  </td>
                  <td className="distance-value">
                    {distance !== null ? `${distance.toFixed(1)} mi` : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="neighbor-info-legend">
        <h4>Signal Quality Guide for {channel || 'Unknown'} Preset</h4>
        <div className="legend-items">
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#22c55e' }} />
            <span>Excellent (≥{thresholds.excellent} dB)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#84cc16' }} />
            <span>Good ({thresholds.good}→{thresholds.excellent} dB)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#eab308' }} />
            <span>Fair ({thresholds.fair}→{thresholds.good} dB)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#f97316' }} />
            <span>Marginal ({thresholds.marginal}→{thresholds.fair} dB)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#ef4444' }} />
            <span>Poor (&lt;{thresholds.marginal} dB)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
