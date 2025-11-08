import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { formatNodeId, getPortNumName, formatLocalDateTime } from '../utils/portNames';
import type { NodeLookup } from '../utils/nodeLookup';

interface PacketDetailProps {
  packetId: number;
  nodeLookup: NodeLookup | null;
  onBack: () => void;
  onNodeClick: (nodeId: string) => void;
  onChannelMismatch: (channel: string, type: 'node' | 'packet') => void;
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

export function PacketDetail({ packetId, nodeLookup, onBack, onNodeClick, onChannelMismatch }: PacketDetailProps) {
  const [packet, setPacket] = useState<PacketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
          includeGateways: true
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
                </tr>
              </thead>
              <tbody>
                {packet.gateways
                  .map((gw) => {
                    const hopInfo = getHopInfo(gw, packet.from_node_id);
                    return { gw, hopInfo };
                  })
                  .sort((a, b) => a.hopInfo.hopCount - b.hopInfo.hopCount)
                  .map(({ gw, hopInfo }, idx, arr) => {
                    const prevHopCount = idx > 0 ? arr[idx - 1].hopInfo.hopCount : null;
                    const showDivider = prevHopCount !== null && prevHopCount !== hopInfo.hopCount;
                    
                    return (
                      <>
                        {showDivider && (
                          <tr key={`divider-${idx}`} className="gateway-divider">
                            <td colSpan={3}><hr /></td>
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
                            {hopInfo.showSignal && gw.rx_snr !== undefined && gw.rx_rssi !== undefined
                              ? `${gw.rx_snr} dB / ${gw.rx_rssi} dBm`
                              : ''}
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
