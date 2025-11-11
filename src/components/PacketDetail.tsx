import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { formatNodeId, getPortNumName, formatLocalDateTime } from '../utils/portNames';
import type { NodeLookup } from '../utils/nodeLookup';
import { TracerouteVisualization } from './TracerouteVisualization';
import { NeighborInfoVisualization } from './NeighborInfoVisualization';
import { parseTraceroutePayload } from '../utils/tracerouteParser';

// RSSI Quality thresholds for different Meshtastic channel presets (in dBm)
const RSSI_THRESHOLDS: Record<string, { excellent: number; good: number; fair: number; marginal: number }> = {
  ShortTurbo: { excellent: -70, good: -85, fair: -95, marginal: -105 },
  ShortFast: { excellent: -72, good: -88, fair: -98, marginal: -110 },
  ShortSlow: { excellent: -75, good: -90, fair: -102, marginal: -115 },
  MediumFast: { excellent: -78, good: -92, fair: -105, marginal: -120 },
  MediumSlow: { excellent: -80, good: -95, fair: -110, marginal: -125 },
  LongFast: { excellent: -85, good: -100, fair: -115, marginal: -130 },
  LongSlow: { excellent: -90, good: -105, fair: -120, marginal: -135 },
  default: { excellent: -78, good: -92, fair: -105, marginal: -120 }, // Use MediumFast as default
};

interface PacketDetailProps {
  packetId: number;
  nodeLookup: NodeLookup | null;
  onBack: () => void;
  onNodeClick: (nodeId: string) => void;
  onChannelMismatch: (channel: string, type: 'node' | 'packet') => void;
  onTracerouteClick?: (packetId: number) => void;
}

interface PacketData {
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
  }>;
}

export function PacketDetail({ packetId, nodeLookup, onBack, onNodeClick, onChannelMismatch, onTracerouteClick }: PacketDetailProps) {
  const [packet, setPacket] = useState<PacketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasTracerouteData, setHasTracerouteData] = useState<boolean>(false);
  const [checkingTraceroute, setCheckingTraceroute] = useState<boolean>(false);
  const hasShownNotification = useRef(false);

  useEffect(() => {
    // Reset notification flag when packetId changes
    hasShownNotification.current = false;
  }, [packetId]);

  useEffect(() => {
    const fetchPacketDetail = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.getPacketDetail(packetId, {
          decode_payload: true,
          includeGateways: true,
          gatewayLimit: 100
        });
        setPacket(data);
        
        // Check for channel mismatch and notify (only once per packet)
        if (!hasShownNotification.current) {
          onChannelMismatch(data.channel, 'packet');
          hasShownNotification.current = true;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch packet details');
        console.error('Error fetching packet details:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPacketDetail();
  }, [packetId, onChannelMismatch]);

  // Check if this packet has traceroute observations (only for portnum 70)
  // If the payload has request_id, use that as the traceroute ID, otherwise use packet ID
  useEffect(() => {
    if (!packet || packet.portnum !== 70) {
      setHasTracerouteData(false);
      return;
    }

    // Check if payload has request_id
    let tracerouteId = packetId;
    if (typeof packet.payload === 'object' && packet.payload !== null && 'request_id' in packet.payload) {
      tracerouteId = packet.payload.request_id as number;
    }

    // If we have a request_id, we know there's traceroute data
    setHasTracerouteData(tracerouteId !== packetId || true);
    setCheckingTraceroute(false);
  }, [packet, packetId]);

  const getNodeName = (nodeId: number): string => {
    if (!nodeLookup) return formatNodeId(nodeId);
    return nodeLookup.getNodeName(nodeId);
  };

  const getPayloadDisplay = (payload: string | { type: string; [key: string]: unknown }): string => {
    if (typeof payload === 'object' && payload !== null) {
      return JSON.stringify(payload, null, 2);
    }
    return payload || '(empty)';
  };

  // Check if this is a traceroute packet
  const isTraceroute = packet?.portnum === 70;
  const tracerouteData = isTraceroute && packet?.payload_hex 
    ? parseTraceroutePayload(packet.payload_hex) 
    : null;

  // Check if this is a neighbor info packet and extract neighbors
  const isNeighborInfo = packet?.portnum === 71;
  const neighborData = isNeighborInfo && typeof packet?.payload === 'object' && packet.payload !== null && 'neighbors' in packet.payload
    ? (packet.payload.neighbors as Array<{ node_id: number; snr?: number }>)
    : null;

  // Get the traceroute ID to use (request_id if available, otherwise packet ID)
  const getTracerouteId = (): number => {
    if (packet && typeof packet.payload === 'object' && packet.payload !== null && 'request_id' in packet.payload) {
      return packet.payload.request_id as number;
    }
    return packetId;
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

  const getDistance = (fromNodeId: number, toNodeId: number): number | null => {
    if (!nodeLookup) return null;
    
    const fromNode = nodeLookup.getNode(fromNodeId);
    const toNode = nodeLookup.getNode(toNodeId);
    
    if (!fromNode || !toNode) return null;
    if (!fromNode.last_lat || !fromNode.last_long || !toNode.last_lat || !toNode.last_long) return null;
    if (fromNode.last_lat === 0 || fromNode.last_long === 0 || toNode.last_lat === 0 || toNode.last_long === 0) return null;
    
    // Convert from integer coordinates to decimal degrees (Meshtastic stores coords * 10^7)
    const fromLatDeg = fromNode.last_lat / 10000000;
    const fromLonDeg = fromNode.last_long / 10000000;
    const toLatDeg = toNode.last_lat / 10000000;
    const toLonDeg = toNode.last_long / 10000000;
    
    return calculateDistance(fromLatDeg, fromLonDeg, toLatDeg, toLonDeg);
  };

  const getRssiQuality = (rssi: number | undefined, channel?: string): { label: string; color: string } => {
    if (rssi === undefined) return { label: 'Unknown', color: '#6b7280' };
    
    const thresholds = RSSI_THRESHOLDS[channel || 'default'] || RSSI_THRESHOLDS.default;
    
    if (rssi >= thresholds.excellent) return { label: 'Excellent', color: '#22c55e' };
    if (rssi >= thresholds.good) return { label: 'Good', color: '#84cc16' };
    if (rssi >= thresholds.fair) return { label: 'Fair', color: '#eab308' };
    if (rssi >= thresholds.marginal) return { label: 'Marginal', color: '#f97316' };
    return { label: 'Poor', color: '#ef4444' };
  };

  const getSnrQuality = (snr: number | undefined): { label: string; color: string } => {
    if (snr === undefined) return { label: 'Unknown', color: '#6b7280' };
    
    // SNR quality is generally consistent across presets
    if (snr >= 8) return { label: 'Excellent', color: '#22c55e' };
    if (snr >= 3) return { label: 'Good', color: '#84cc16' };
    if (snr >= -4) return { label: 'Fair', color: '#eab308' };
    if (snr >= -12.5) return { label: 'Marginal', color: '#f97316' };
    return { label: 'Poor', color: '#ef4444' };
  };

  const getHopInfo = (gw: { node_id: number; node_name?: string; rx_rssi?: number; rx_snr?: number; hop_start?: number; hop_limit?: number }, packetFromNodeId: number): { hopText: string; hopCount: number; showSignal: boolean } => {
    // Check if gateway is the packet sender (self-gated)
    if (gw.node_id === packetFromNodeId) {
      return { hopText: '(Self Gated)', hopCount: -1, showSignal: false };
    }

    const hopStart = gw.hop_start ?? packet?.hop_start;
    const hopLimit = gw.hop_limit ?? packet?.hop_limit;

    // If both hop values are present
    if (typeof hopStart === 'number' && typeof hopLimit === 'number') {
      const hopsUsed = hopStart - hopLimit;
      // Both are 0 or hops used is 0 means direct connection - show SNR/RSSI
      if ((hopStart === 0 && hopLimit === 0) || hopsUsed === 0) {
        return { hopText: 'Direct', hopCount: 0, showSignal: true };
      }
      // Return hop count - don't show signal for relayed packets
      return { hopText: `${hopsUsed} hop${hopsUsed !== 1 ? 's' : ''}`, hopCount: hopsUsed, showSignal: false };
    }
    
    return { hopText: 'Unknown', hopCount: 999, showSignal: false };
  };

  if (loading) {
    return <div className="loading">Loading packet details...</div>;
  }

  if (error || !packet) {
    return (
      <div className="packet-detail-error">
        <button onClick={onBack} className="btn-secondary">← Back</button>
        <div className="error">{error || 'Packet not found'}</div>
      </div>
    );
  }

  return (
    <div className="packet-detail">
      <div className="packet-detail-header">
        <button onClick={onBack} className="btn-secondary">← Back</button>
        <h2>Packet Details</h2>
      </div>

      <div className="packet-info-cards">
        {isNeighborInfo && neighborData && neighborData.length > 0 && (
          <div className="packet-neighbor-card">
            <NeighborInfoVisualization
              neighbors={neighborData}
              sourceNodeId={packet.from_node_id}
              nodeLookup={nodeLookup}
              onNodeClick={onNodeClick}
              channel={packet.channel}
            />
          </div>
        )}

        {isTraceroute && tracerouteData && tracerouteData.route.length > 0 && (
          <div className="packet-traceroute-card">
            <TracerouteVisualization
              packetId={packet.id}
              route={tracerouteData.route}
              fromNodeId={packet.from_node_id}
              toNodeId={packet.to_node_id}
              nodeLookup={nodeLookup}
              onNodeClick={onNodeClick}
            />
            {/* Show button if this traceroute observation packet has full traceroute data */}
            {hasTracerouteData && onTracerouteClick && (
              <div className="traceroute-actions">
                <button 
                  className="btn-primary"
                  onClick={() => onTracerouteClick(getTracerouteId())}
                  disabled={checkingTraceroute}
                >
                  View Full Traceroute Details →
                </button>
                <p className="traceroute-hint">
                  See all routes observed by different gateways and a comprehensive network graph
                </p>
              </div>
            )}
          </div>
        )}

        <div className="packet-info-card">
          <h3>Basic Information</h3>
          <div className="info-item">
            <span className="info-label">Packet ID:</span>
            <span className="info-value">{packet.id}</span>
          </div>
          <div className="info-item">
            <span className="info-label">From:</span>
            <span className="info-value">
              <button 
                className="node-link"
                onClick={() => onNodeClick(formatNodeId(packet.from_node_id))}
              >
                {getNodeName(packet.from_node_id)}
              </button>
              <span className="node-hex">({formatNodeId(packet.from_node_id)})</span>
            </span>
          </div>
          <div className="info-item">
            <span className="info-label">To:</span>
            <span className="info-value">
              <button 
                className="node-link"
                onClick={() => onNodeClick(formatNodeId(packet.to_node_id))}
              >
                {getNodeName(packet.to_node_id)}
              </button>
              <span className="node-hex">({formatNodeId(packet.to_node_id)})</span>
            </span>
          </div>
          <div className="info-item">
            <span className="info-label">Channel:</span>
            <span className="info-value">{packet.channel}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Port:</span>
            <span className="info-value">{getPortNumName(packet.portnum.toString())}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Time:</span>
            <span className="info-value">{formatLocalDateTime(packet.import_time)}</span>
          </div>
          {packet.hop_start !== undefined && (
            <div className="info-item">
              <span className="info-label">Hop Limit:</span>
              <span className="info-value">{packet.hop_start}</span>
            </div>
          )}
        </div>

        <div className="packet-payload-card">
          <h3>Payload</h3>
          <pre className="payload-display">{getPayloadDisplay(packet.payload)}</pre>
          {packet.payload_hex && (
            <>
              <h4>Raw Hex</h4>
              <pre className="payload-hex">{packet.payload_hex}</pre>
            </>
          )}
        </div>

        {packet.gateways && packet.gateways.length > 0 && (
          <div className="packet-gateways-card">
            <h3>Gateways ({packet.gateways.length})</h3>
            <p className="gateways-desc">Nodes that heard this packet:</p>
            <table className="gateways-table">
              <thead>
                <tr>
                  <th>Gateway</th>
                  <th>Hops</th>
                  <th>Signal</th>
                  <th>Distance</th>
                </tr>
              </thead>
              <tbody>
                {packet.gateways
                  .map((gw) => {
                    const hopInfo = getHopInfo(gw, packet.from_node_id);
                    const distance = getDistance(packet.from_node_id, gw.node_id);
                    return { gw, hopInfo, distance };
                  })
                  .sort((a, b) => a.hopInfo.hopCount - b.hopInfo.hopCount)
                  .map(({ gw, hopInfo, distance }, idx, arr) => {
                    const prevHopCount = idx > 0 ? arr[idx - 1].hopInfo.hopCount : null;
                    const showDivider = prevHopCount !== null && prevHopCount !== hopInfo.hopCount;
                    
                    return (
                      <>
                        {showDivider && (
                          <tr key={`divider-${idx}`} className="gateway-divider">
                            <td colSpan={4}><hr /></td>
                          </tr>
                        )}
                        <tr key={idx}>
                          <td>
                            <button 
                              className="node-link"
                              onClick={() => onNodeClick(formatNodeId(gw.node_id))}
                            >
                              {gw.node_name || getNodeName(gw.node_id)}
                            </button>
                            <span className="node-hex">({formatNodeId(gw.node_id)})</span>
                          </td>
                          <td>{hopInfo.hopText}</td>
                          <td>
                            {hopInfo.showSignal && gw.rx_snr !== undefined && gw.rx_rssi !== undefined ? (
                              <div className="signal-quality-container">
                                <div className="signal-row">
                                  <span className="signal-label">SNR:</span>
                                  <span className="signal-value">{gw.rx_snr} dB</span>
                                  <span 
                                    className="quality-badge quality-badge-compact" 
                                    style={{ backgroundColor: getSnrQuality(gw.rx_snr).color }}
                                    title={`SNR Quality: ${getSnrQuality(gw.rx_snr).label}`}
                                  >
                                    {getSnrQuality(gw.rx_snr).label}
                                  </span>
                                </div>
                                <div className="signal-row">
                                  <span className="signal-label">RSSI:</span>
                                  <span className="signal-value">{gw.rx_rssi} dBm</span>
                                  <span 
                                    className="quality-badge quality-badge-compact" 
                                    style={{ backgroundColor: getRssiQuality(gw.rx_rssi, packet.channel).color }}
                                    title={`RSSI Quality: ${getRssiQuality(gw.rx_rssi, packet.channel).label}`}
                                  >
                                    {getRssiQuality(gw.rx_rssi, packet.channel).label}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              ''
                            )}
                          </td>
                          <td className="distance-value">
                            {hopInfo.showSignal && distance !== null ? `${distance.toFixed(1)} mi` : ''}
                          </td>
                        </tr>
                      </>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
