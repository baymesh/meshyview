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
    relay_node?: number;
  }>;
}

export function PacketDetail({ packetId, nodeLookup, onBack, onNodeClick, onChannelMismatch, onTracerouteClick }: PacketDetailProps) {
  const [packet, setPacket] = useState<PacketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasTracerouteData, setHasTracerouteData] = useState<boolean>(false);
  const [checkingTraceroute, setCheckingTraceroute] = useState<boolean>(false);
  const [relayMatches, setRelayMatches] = useState<Map<number, number[]>>(new Map());
  const [_ambiguousRelayCount, setAmbiguousRelayCount] = useState<number>(0);
  const [refiningGateways, setRefiningGateways] = useState<Set<number>>(new Set());
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

  // Phase 1: Quick local lookup for relay nodes using only gateway data
  useEffect(() => {
    if (!packet?.gateways || packet.gateways.length === 0 || !nodeLookup) {
      setRelayMatches(new Map());
      setAmbiguousRelayCount(0);
      return;
    }

    const matches = new Map<number, number[]>();
    let ambiguousCount = 0;
    
    for (const gw of packet.gateways!) {
      if (gw.relay_node !== undefined && gw.relay_node !== null) {
        // Check all nodes in the nodeLookup for matching last byte on the same channel
        const potentialNodes: number[] = [];
        
        // Get all nodes on the same channel
        const allNodes = nodeLookup.getAllNodes();
        for (const node of allNodes) {
          // Only consider nodes on the same channel
          if (node.channel === packet.channel && (node.node_id & 255) === gw.relay_node) {
            potentialNodes.push(node.node_id);
          }
        }
        
        if (potentialNodes.length > 0) {
          matches.set(gw.node_id, potentialNodes);
          if (potentialNodes.length > 1) {
            ambiguousCount++;
          }
        }
      }
    }
    
    setRelayMatches(matches);
    setAmbiguousRelayCount(ambiguousCount);
  }, [packet, nodeLookup]);

  // Phase 2: Refine a single gateway's relay match using API
  const refineSingleRelay = async (gwNodeId: number, gwRelayNode: number) => {
    if (!packet?.gateways) return;
    
    const gw = packet.gateways.find(g => g.node_id === gwNodeId);
    if (!gw) return;
    
    // Mark as refining
    setRefiningGateways(prev => new Set(prev).add(gwNodeId));
    
    try {
      const neighbors = await api.getNodeNeighbors(gwNodeId);
      const gwName = gw.node_name || getNodeName(gwNodeId);
      
      console.log(`[Relay Debug] Gateway: ${gwName} (${gwNodeId}, relay_node: ${gwRelayNode})`);
      console.log(`  heard_from:`, neighbors.heard_from.map(n => `${n.node_id} (last byte: ${n.node_id & 255}, packets: ${n.packet_count})`));
      console.log(`  heard_by:`, neighbors.heard_by.map(n => `${n.node_id} (last byte: ${n.node_id & 255}, packets: ${n.packet_count})`));
      
      // Prefer heard_from (nodes this gateway heard from), fallback to heard_by
      let matchingNeighbors = neighbors.heard_from
        .filter(n => (n.node_id & 255) === gwRelayNode);
      
      console.log(`  heard_from matches:`, matchingNeighbors.map(n => `${n.node_id} (packets: ${n.packet_count})`));
      
      if (matchingNeighbors.length === 0) {
        // Fallback to heard_by if nothing in heard_from
        matchingNeighbors = neighbors.heard_by
          .filter(n => (n.node_id & 255) === gwRelayNode);
        console.log(`  heard_by matches (fallback):`, matchingNeighbors.map(n => `${n.node_id} (packets: ${n.packet_count})`));
      }
      
      if (matchingNeighbors.length > 0) {
        // Sort by packet_count descending and take the top one (most likely relay)
        matchingNeighbors.sort((a, b) => b.packet_count - a.packet_count);
        const bestMatch = matchingNeighbors[0].node_id;
        
        console.log(`  ✓ Selected best match: ${bestMatch} with ${matchingNeighbors[0].packet_count} packets`);
        
        setRelayMatches(prev => {
          const updated = new Map(prev);
          updated.set(gwNodeId, [bestMatch]);
          return updated;
        });
      } else {
        console.log(`  ✗ No matches found!`);
      }
    } catch (err) {
      console.error(`Error fetching neighbors for node ${gwNodeId}:`, err);
    } finally {
      // Remove from refining set
      setRefiningGateways(prev => {
        const updated = new Set(prev);
        updated.delete(gwNodeId);
        return updated;
      });
      
      // Recalculate ambiguous count
      setRelayMatches(prev => {
        let stillAmbiguous = 0;
        prev.forEach(matches => {
          if (matches.length > 1) stillAmbiguous++;
        });
        setAmbiguousRelayCount(stillAmbiguous);
        return prev;
      });
    }
  };

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
  
  // Try to get route from decoded payload first, fallback to parsing hex
  let tracerouteData: { route: number[] } | null = null;
  if (isTraceroute) {
    if (typeof packet?.payload === 'object' && packet.payload !== null && 'route' in packet.payload) {
      // Use decoded route from payload
      tracerouteData = { route: packet.payload.route as number[] };
    } else if (packet?.payload_hex) {
      // Fallback to parsing hex payload
      tracerouteData = parseTraceroutePayload(packet.payload_hex);
    }
  }
  
  const tracerouteDone = isTraceroute && typeof packet?.payload === 'object' && packet.payload !== null && 'done' in packet.payload
    ? (packet.payload.done as boolean)
    : false;

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
              isDone={tracerouteDone}
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
            <div className="gateways-header">
              <div>
                <h3>Gateways ({packet.gateways.length})</h3>
                <p className="gateways-desc">Nodes that heard this packet:</p>
              </div>
            </div>
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
                            <div className="gateway-cell">
                              <div className="gateway-name">
                                <button 
                                  className="node-link"
                                  onClick={() => onNodeClick(formatNodeId(gw.node_id))}
                                >
                                  {gw.node_name || getNodeName(gw.node_id)}
                                </button>
                                <span className="node-hex">({formatNodeId(gw.node_id)})</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            {hopInfo.hopText}
                            {/* Only show relay info if it's NOT a direct connection */}
                            {hopInfo.hopCount > 0 && gw.relay_node !== undefined && gw.relay_node !== null && relayMatches.has(gw.node_id) && (() => {
                              let matches = relayMatches.get(gw.node_id)!;
                              const hasMultipleMatches = matches.length > 1;
                              const isRefining = refiningGateways.has(gw.node_id);
                              
                              // If multiple matches and gateway has location, sort by distance
                              if (matches.length > 1 && nodeLookup) {
                                const gwNode = nodeLookup.getNode(gw.node_id);
                                if (gwNode?.last_lat && gwNode?.last_long && gwNode.last_lat !== 0 && gwNode.last_long !== 0) {
                                  // Calculate distances for each match
                                  const matchesWithDistance = matches.map(nodeId => {
                                    const dist = getDistance(gw.node_id, nodeId);
                                    return { nodeId, distance: dist };
                                  });
                                  
                                  // Sort: nodes with distances first (ascending), then nodes without distances
                                  matchesWithDistance.sort((a, b) => {
                                    if (a.distance === null && b.distance === null) return 0;
                                    if (a.distance === null) return 1;
                                    if (b.distance === null) return -1;
                                    return a.distance - b.distance;
                                  });
                                  
                                  return (
                                    <div className={`relay-info ${isRefining ? 'relay-refining' : ''}`}>
                                      via {matchesWithDistance.map((match, idx) => (
                                        <span key={match.nodeId}>
                                          {idx > 0 && ' or '}
                                          <button 
                                            className="node-link relay-node-link"
                                            onClick={() => onNodeClick(formatNodeId(match.nodeId))}
                                            title={`Relay node (last byte: ${gw.relay_node})`}
                                          >
                                            {getNodeName(match.nodeId)}
                                          </button>
                                          <span className="relay-distance">
                                            {match.distance !== null ? ` (${match.distance.toFixed(1)} mi)` : ' (? mi)'}
                                          </span>
                                        </span>
                                      ))}
                                      {hasMultipleMatches && !isRefining && (
                                        <button
                                          className="refine-single-btn"
                                          onClick={() => refineSingleRelay(gw.node_id, gw.relay_node!)}
                                          title="Refine using API to find best match"
                                        >
                                          ⚡
                                        </button>
                                      )}
                                      {isRefining && <span className="refining-indicator"></span>}
                                    </div>
                                  );
                                }
                              }
                              
                              // Default rendering without distance sorting
                              return (
                                <div className={`relay-info ${isRefining ? 'relay-refining' : ''}`}>
                                  via {matches.map((nodeId, idx) => (
                                    <span key={nodeId}>
                                      {idx > 0 && ' or '}
                                      <button 
                                        className="node-link relay-node-link"
                                        onClick={() => onNodeClick(formatNodeId(nodeId))}
                                        title={`Relay node (last byte: ${gw.relay_node})`}
                                      >
                                        {getNodeName(nodeId)}
                                      </button>
                                    </span>
                                  ))}
                                  {hasMultipleMatches && !isRefining && (
                                    <button
                                      className="refine-single-btn"
                                      onClick={() => refineSingleRelay(gw.node_id, gw.relay_node!)}
                                      title="Refine using API to find best match"
                                    >
                                      ⚡
                                    </button>
                                  )}
                                  {isRefining && <span className="refining-indicator"></span>}
                                </div>
                              );
                            })()}
                          </td>
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
