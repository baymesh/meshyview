import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { api } from '../api';
import type { Node } from '../types';
import { formatNodeId, parseNodeId, getPortNumName, formatLocalDateTime } from '../utils/portNames';
import type { NodeLookup } from '../utils/nodeLookup';

// Fix for default marker icons
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';

const DefaultIcon = L.icon({
  iconUrl: icon,
  iconRetinaUrl: iconRetina,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

const COORDINATE_SCALE_FACTOR = 10000000;

interface NodeDetailProps {
  nodeId: string;
  nodeLookup: NodeLookup | null;
  onBack: () => void;
  onPacketClick: (packetId: number) => void;
  onNodeClick: (nodeId: string) => void;
  onChannelMismatch: (channel: string, type: 'node' | 'packet') => void;
}

interface Packet {
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
}

export function NodeDetail({ nodeId, nodeLookup, onBack, onPacketClick, onNodeClick, onChannelMismatch }: NodeDetailProps) {
  const [node, setNode] = useState<Node | null>(null);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasShownNotification = useRef(false);

  useEffect(() => {
    // Reset notification flag when nodeId changes
    hasShownNotification.current = false;
  }, [nodeId]);

  useEffect(() => {
    const fetchNodeDetails = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Parse the node ID from various formats
        const parsedNodeId = parseNodeId(nodeId);
        if (parsedNodeId === null) {
          setError('Invalid node ID format');
          setLoading(false);
          return;
        }
        
        // Convert to hex format for comparison
        const hexNodeId = formatNodeId(parsedNodeId);
        
        // Fetch nodes with higher limit to ensure we can find the node
        const nodesData = await api.getNodes({ limit: 1500 });
        
        // Compare both hex ID and numeric ID
        const foundNode = nodesData.nodes.find(n => {
          // Try comparing as hex string
          if (n.id === hexNodeId) return true;
          // Try parsing the node's ID and comparing numerically
          const nId = parseNodeId(n.id);
          if (nId !== null && nId === parsedNodeId) return true;
          return false;
        });
        
        if (!foundNode) {
          setError('Node not found');
          setLoading(false);
          return;
        }
        
        setNode(foundNode);
        
        // Check for channel mismatch and notify (only once per node)
        if (!hasShownNotification.current) {
          onChannelMismatch(foundNode.channel, 'node');
          hasShownNotification.current = true;
        }
        
        // Fetch recent packets for this node using the node's actual ID from API
        const packetsData = await api.getPackets({
          node_id: foundNode.id,
          limit: 50,
          decode_payload: true
        });
        setPackets(packetsData.packets || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch node details');
        console.error('Error fetching node details:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchNodeDetails();
  }, [nodeId, onChannelMismatch]);

  if (loading) {
    return <div className="loading">Loading node details...</div>;
  }

  if (error) {
    return (
      <div className="node-detail-error">
        <button onClick={onBack} className="btn-secondary">← Back</button>
        <div className="error">{error}</div>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="node-detail-error">
        <button onClick={onBack} className="btn-secondary">← Back</button>
        <div className="error">Node not found</div>
      </div>
    );
  }

  const hasLocation = node.last_lat !== null && node.last_long !== null;
  const coordinates = hasLocation 
    ? [node.last_lat! / COORDINATE_SCALE_FACTOR, node.last_long! / COORDINATE_SCALE_FACTOR] as [number, number]
    : null;

  const getNodeName = (nodeId: number): string => {
    if (!nodeLookup) return formatNodeId(nodeId);
    return nodeLookup.getNodeName(nodeId);
  };

  const isClickableNode = (nodeId: number): boolean => {
    // Node is clickable if it's not the current node and it exists in our lookup
    if (!nodeLookup || nodeId === node?.node_id) {
      return false;
    }
    const nodeData = nodeLookup.getNode(nodeId);
    return nodeData !== undefined && nodeData.id !== undefined;
  };

  const handleNodeLinkClick = (nodeId: number) => {
    // Find the node by numeric ID
    if (nodeLookup) {
      const nodeData = nodeLookup.getNode(nodeId);
      if (nodeData?.id) {
        onNodeClick(nodeData.id);
      }
    }
  };

  return (
    <div className="node-detail">
      <div className="node-detail-header">
        <button onClick={onBack} className="btn-secondary">← Back</button>
        <h2>Node Details: {node.long_name}</h2>
      </div>

      <div className="node-info-cards">
        <div className="node-info-card">
          <h3>Basic Information</h3>
          <div className="info-item">
            <span className="info-label">Name:</span>
            <span className="info-value">{node.long_name}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Short Name:</span>
            <span className="info-value">{node.short_name}</span>
          </div>
          <div className="info-item">
            <span className="info-label">ID:</span>
            <span className="info-value">{node.id}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Node ID:</span>
            <span className="info-value">{node.node_id}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Role:</span>
            <span className="info-value">{node.role}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Hardware:</span>
            <span className="info-value">{node.hw_model}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Firmware:</span>
            <span className="info-value">{node.firmware || 'N/A'}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Channel:</span>
            <span className="info-value">{node.channel}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Last Update:</span>
            <span className="info-value">{formatLocalDateTime(node.last_update)}</span>
          </div>
        </div>

        {coordinates && (
          <div className="node-map-card">
            <h3>Location</h3>
            <div className="node-map">
              <MapContainer
                center={coordinates}
                zoom={13}
                style={{ height: '300px', width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Marker position={coordinates}>
                  <Popup>{node.long_name}</Popup>
                </Marker>
              </MapContainer>
            </div>
          </div>
        )}

        <div className="node-packets-card">
          <h3>Recent Packets ({packets.length})</h3>
          <div className="packets-table-container">
            <table className="packets-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Timestamp</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Port</th>
                  <th>Channel</th>
                </tr>
              </thead>
              <tbody>
                {packets.map((pkt) => {
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {packets.length === 0 && (
              <div className="no-packets">No recent packets found</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
