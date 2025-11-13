import { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import { api } from '../api';
import type { Node, NodeNeighborsResponse } from '../types';
import { formatNodeId, parseNodeId, getPortNumName, formatLocalDateTime } from '../utils/portNames';
import type { NodeLookup } from '../utils/nodeLookup';

const { BaseLayer } = LayersControl;

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

// Create a more subtle icon for historical positions
const HistoricalIcon = L.icon({
  iconUrl: icon,
  iconRetinaUrl: iconRetina,
  shadowUrl: iconShadow,
  iconSize: [15, 24],  // Smaller than default
  iconAnchor: [7, 24],
  popupAnchor: [1, -20],
  shadowSize: [24, 24],
  className: 'historical-marker'
});

// Create icons for neighbor nodes
const HeardFromIcon = L.divIcon({
  className: 'custom-marker heard-from-marker',
  html: '<div class="marker-pin heard-from-pin"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 20],
  popupAnchor: [0, -20]
});

const HeardByIcon = L.divIcon({
  className: 'custom-marker heard-by-marker',
  html: '<div class="marker-pin heard-by-pin"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 20],
  popupAnchor: [0, -20]
});

L.Marker.prototype.options.icon = DefaultIcon;

const COORDINATE_SCALE_FACTOR = 10000000;
const POSITION_PORTNUM = 3;

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
  gateway_count?: number;
}

type PacketFilter = 'all' | 'from' | 'to';
type SortField = 'timestamp' | 'gateways';
type SortDirection = 'asc' | 'desc';
type TabType = 'neighbors' | 'packets' | 'heard';

interface HistoricalPosition {
  lat: number;
  lng: number;
  packets: Array<{
    id: number;
    timestamp: string;
  }>;
}

// Helper function to extract position from packet payload
function extractPosition(packet: Packet): { lat: number; lng: number } | null {
  if (packet.portnum !== POSITION_PORTNUM) {
    return null;
  }
  
  const payload = packet.payload;
  if (typeof payload === 'object' && payload !== null) {
    // Check for latitude_i and longitude_i (scaled integers)
    if ('latitude_i' in payload && 'longitude_i' in payload) {
      const lat = typeof payload.latitude_i === 'number' ? payload.latitude_i / COORDINATE_SCALE_FACTOR : null;
      const lng = typeof payload.longitude_i === 'number' ? payload.longitude_i / COORDINATE_SCALE_FACTOR : null;
      if (lat !== null && lng !== null && lat !== 0 && lng !== 0) {
        return { lat, lng };
      }
    }
    // Check for direct lat/lng fields
    if ('latitude' in payload && 'longitude' in payload) {
      const lat = typeof payload.latitude === 'number' ? payload.latitude : null;
      const lng = typeof payload.longitude === 'number' ? payload.longitude : null;
      if (lat !== null && lng !== null && lat !== 0 && lng !== 0) {
        return { lat, lng };
      }
    }
  }
  
  return null;
}

// Helper function to group positions by location
function groupPositionsByLocation(packets: Packet[]): HistoricalPosition[] {
  const locationMap = new Map<string, HistoricalPosition>();
  
  for (const packet of packets) {
    const position = extractPosition(packet);
    if (!position) continue;
    
    // Round to 6 decimal places (~0.1m precision) for grouping
    const lat = Math.round(position.lat * 1000000) / 1000000;
    const lng = Math.round(position.lng * 1000000) / 1000000;
    const key = `${lat},${lng}`;
    
    const timestamp = packet.timestamp || packet.import_time || '';
    
    if (locationMap.has(key)) {
      locationMap.get(key)!.packets.push({ id: packet.id, timestamp });
    } else {
      locationMap.set(key, {
        lat,
        lng,
        packets: [{ id: packet.id, timestamp }]
      });
    }
  }
  
  return Array.from(locationMap.values());
}

export function NodeDetail({ nodeId, nodeLookup, onBack, onPacketClick, onNodeClick, onChannelMismatch }: NodeDetailProps) {
  const [node, setNode] = useState<Node | null>(null);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [heardPackets, setHeardPackets] = useState<Packet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [neighbors, setNeighbors] = useState<NodeNeighborsResponse | null>(null);
  const [neighborsLoading, setNeighborsLoading] = useState(false);
  const [heardPacketsLoading, setHeardPacketsLoading] = useState(false);
  const hasShownNotification = useRef(false);
  const hasLoadedNeighbors = useRef(false);
  const hasLoadedPackets = useRef(false);
  const hasLoadedHeardPackets = useRef(false);
  
  // Tab state from URL hash
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const hash = window.location.hash.slice(1);
    if (hash === 'packets' || hash === 'heard') return hash;
    return 'neighbors';
  });
  const [selectedHistoricalIndex, setSelectedHistoricalIndex] = useState<Record<string, number>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const [packetFilter, setPacketFilter] = useState<PacketFilter>('all');
  const [selectedPort, setSelectedPort] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [mapExpanded, setMapExpanded] = useState(false);
  const mapCardRef = useRef<HTMLDivElement>(null);

  // Filter and sort packets - must be before useEffect hooks
  const filteredAndSortedPackets = useMemo(() => {
    if (!node) return [];

    // First filter by direction
    let filtered = packets;
    if (packetFilter === 'from') {
      filtered = packets.filter(pkt => pkt.from_node_id === node.node_id);
    } else if (packetFilter === 'to') {
      filtered = packets.filter(pkt => pkt.to_node_id === node.node_id);
    }

    // Then filter by port
    if (selectedPort !== 'all') {
      filtered = filtered.filter(pkt => pkt.portnum?.toString() === selectedPort);
    }

    // Then sort
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      let aValue: number;
      let bValue: number;

      if (sortField === 'gateways') {
        aValue = a.gateway_count ?? 0;
        bValue = b.gateway_count ?? 0;
      } else {
        const aTime = a.timestamp || a.import_time || '';
        const bTime = b.timestamp || b.import_time || '';
        aValue = new Date(aTime).getTime();
        bValue = new Date(bTime).getTime();
      }

      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
    });

    return sorted;
  }, [packets, node, packetFilter, selectedPort, sortField, sortDirection]);

  const uniquePorts = useMemo(() => {
    const ports = new Set(packets.map(pkt => pkt.portnum?.toString()).filter((p): p is string => !!p));
    return Array.from(ports).sort((a, b) => parseInt(a) - parseInt(b));
  }, [packets]);

  useEffect(() => {
    // Reset notification flag when nodeId changes
    hasShownNotification.current = false;
    hasLoadedNeighbors.current = false;
    hasLoadedPackets.current = false;
    hasLoadedHeardPackets.current = false;
  }, [nodeId]);

  // Handle URL hash changes for tab navigation
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash === 'packets' || hash === 'heard' || hash === 'neighbors') {
        setActiveTab(hash);
      }
    };
    
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Update URL hash when tab changes
  const switchTab = (tab: TabType) => {
    setActiveTab(tab);
    window.location.hash = tab;
  };

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
        
        // Don't load packets here - wait for tab activation
        setPackets([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch node details');
        console.error('Error fetching node details:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchNodeDetails();
  }, [nodeId, onChannelMismatch]);

  // Fetch neighbors when tab becomes active
  useEffect(() => {
    if (activeTab !== 'neighbors' || !node || hasLoadedNeighbors.current) return;

    const fetchNeighbors = async () => {
      try {
        setNeighborsLoading(true);
        const neighborsData = await api.getNodeNeighbors(node.node_id);
        setNeighbors(neighborsData);
        hasLoadedNeighbors.current = true;
      } catch (err) {
        console.error('Error fetching neighbors:', err);
        setNeighbors(null);
      } finally {
        setNeighborsLoading(false);
      }
    };

    fetchNeighbors();
  }, [node, activeTab]);

  // Fetch packets when tab becomes active
  useEffect(() => {
    if (activeTab !== 'packets' || !node || hasLoadedPackets.current) return;

    const fetchPackets = async () => {
      try {
        const packetsData = await api.getPackets({
          node_id: node.id,
          limit: 50,
          decode_payload: true,
          includeGatewayCount: true
        });
        setPackets(packetsData.packets || []);
        hasLoadedPackets.current = true;
      } catch (err) {
        console.error('Error fetching packets:', err);
      }
    };

    fetchPackets();
  }, [node, activeTab]);

  // Fetch packets heard when tab becomes active
  useEffect(() => {
    if (activeTab !== 'heard' || !node || hasLoadedHeardPackets.current) return;

    const fetchHeardPackets = async () => {
      try {
        setHeardPacketsLoading(true);
        const heardData = await api.getPackets({
          gateway_id: formatNodeId(node.node_id),
          limit: 50,
          decode_payload: true,
          includeGatewayCount: true
        });
        setHeardPackets(heardData.packets || []);
        hasLoadedHeardPackets.current = true;
      } catch (err) {
        console.error('Error fetching heard packets:', err);
      } finally {
        setHeardPacketsLoading(false);
      }
    };

    fetchHeardPackets();
  }, [node, activeTab]);

  // WebSocket subscription for real-time updates (only for packets tab)
  useEffect(() => {
    if (!node || activeTab !== 'packets') return;

    // Capture the current node_id to avoid stale closures
    const currentNodeNumericId = node.node_id;

    // Subscribe to packets from this node
    const params = new URLSearchParams();
    params.append('from_node_id', currentNodeNumericId.toString());
    
    const ws = new WebSocket(`wss://meshql.bayme.sh/ws?${params.toString()}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected for node detail updates');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'connected') {
          console.log('Connected to MeshQL WebSocket for node details:', data.filters);
        } else if (data.type === 'subscribed') {
          console.log('Subscribed to node packet updates:', data.filters);
        } else if (data.type === 'node') {
          // Update node info if it's for this node
          if (data.node_id === currentNodeNumericId) {
            setNode(prev => prev ? {
              ...prev,
              ...data,
              last_update: data.last_update || prev.last_update
            } : prev);
          }
        } else if (data.type === 'packet') {
          // Add new packet to the packets list
          if (data.from_node_id === currentNodeNumericId || data.to_node_id === currentNodeNumericId) {
            const newPacket: Packet = {
              id: data.id,
              from_node_id: data.from_node_id,
              to_node_id: data.to_node_id,
              channel: data.channel,
              portnum: data.portnum,
              timestamp: data.timestamp,
              import_time: data.import_time,
              payload: data.payload,
              payload_hex: data.payload_hex
            };
            setPackets(prev => [newPacket, ...prev].slice(0, 50)); // Keep last 50
            
            // Update node position if this is a position packet
            if (data.portnum === 3 && data.from_node_id === currentNodeNumericId && data.payload) {
              if (typeof data.payload === 'object') {
                if ('latitude_i' in data.payload && 'longitude_i' in data.payload) {
                  setNode(prev => prev ? {
                    ...prev,
                    last_lat: data.payload.latitude_i,
                    last_long: data.payload.longitude_i,
                    last_update: data.import_time || prev.last_update
                  } : prev);
                }
              }
            }
          }
        }
      } catch (err) {
        console.debug('WebSocket message parse error:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };

    // Cleanup on unmount or when node changes
    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  // Only reconnect when node.id, node.node_id, or activeTab changes
  // This prevents infinite reconnection loops when node state is updated via WebSocket
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id, node?.node_id, activeTab]);

  if (loading) {
    return <div className="loading" role="status" aria-live="polite">Loading node details...</div>;
  }

  if (error) {
    return (
      <div className="node-detail-error">
        <button onClick={onBack} className="btn-secondary" aria-label="Go back">← Back</button>
        <div className="error" role="alert">{error}</div>
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

  // Extract and group historical positions
  const historicalPositions = hasLocation ? groupPositionsByLocation(packets) : [];
  
  // Filter out historical positions that are at the same location as the current position
  const filteredHistoricalPositions = coordinates 
    ? historicalPositions.filter(pos => {
        const currentLat = Math.round(coordinates[0] * 1000000) / 1000000;
        const currentLng = Math.round(coordinates[1] * 1000000) / 1000000;
        const posLat = Math.round(pos.lat * 1000000) / 1000000;
        const posLng = Math.round(pos.lng * 1000000) / 1000000;
        return currentLat !== posLat || currentLng !== posLng;
      })
    : historicalPositions;

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

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Helper to cycle through packets at the same location
  const cycleHistoricalPacket = (locationKey: string, direction: 'next' | 'prev', totalPackets: number) => {
    const currentIndex = selectedHistoricalIndex[locationKey] || 0;
    let newIndex: number;
    
    if (direction === 'next') {
      newIndex = (currentIndex + 1) % totalPackets;
    } else {
      newIndex = (currentIndex - 1 + totalPackets) % totalPackets;
    }
    
    setSelectedHistoricalIndex(prev => ({
      ...prev,
      [locationKey]: newIndex
    }));
  };

  // Helper to render popup content for historical position
  const renderHistoricalPopup = (position: HistoricalPosition) => {
    const locationKey = `${position.lat},${position.lng}`;
    const currentIndex = selectedHistoricalIndex[locationKey] || 0;
    const currentPacket = position.packets[currentIndex];
    
    return (
      <div style={{ minWidth: '200px' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
          Historical Position
        </div>
        <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
          <div><strong>Time:</strong> {formatLocalDateTime(currentPacket.timestamp)}</div>
          <div>
            <button 
              onClick={() => onPacketClick(currentPacket.id)}
              style={{ 
                color: '#0366d6', 
                background: 'none', 
                border: 'none', 
                cursor: 'pointer', 
                textDecoration: 'underline',
                padding: 0,
                fontSize: '0.85rem'
              }}
            >
              View Packet #{currentPacket.id}
            </button>
          </div>
        </div>
        {position.packets.length > 1 && (
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginTop: '0.5rem',
            paddingTop: '0.5rem',
            borderTop: '1px solid #ddd'
          }}>
            <button
              onClick={() => cycleHistoricalPacket(locationKey, 'prev', position.packets.length)}
              style={{
                padding: '0.25rem 0.5rem',
                background: '#0366d6',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '0.75rem'
              }}
            >
              ← Prev
            </button>
            <span style={{ fontSize: '0.75rem' }}>
              {currentIndex + 1} / {position.packets.length}
            </span>
            <button
              onClick={() => cycleHistoricalPacket(locationKey, 'next', position.packets.length)}
              style={{
                padding: '0.25rem 0.5rem',
                background: '#0366d6',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '0.75rem'
              }}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    );
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
            <span className="info-label">Relay ID:</span>
            <span className="info-value">{node.node_id & 255}</span>
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
          <div className="node-map-card" ref={mapCardRef}>
            <h3>Location</h3>
            <div className="node-map">
              <MapContainer
                key={`${node.id}-${mapExpanded}`}
                center={coordinates}
                zoom={13}
                style={{ height: mapExpanded ? '800px' : '300px', width: '100%' }}
                closePopupOnClick={false}
              >
                <LayersControl position="topright">
                  <BaseLayer checked name="Street Map">
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                  </BaseLayer>
                  
                  <BaseLayer name="Satellite">
                    <TileLayer
                      attribution='Imagery &copy; <a href="https://www.esri.com/">Esri</a>'
                      url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    />
                  </BaseLayer>
                  
                  <BaseLayer name="Terrain">
                    <TileLayer
                      attribution='Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
                      url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
                    />
                  </BaseLayer>
                </LayersControl>
                
                <Marker position={coordinates}>
                  <Popup>
                    <div style={{ fontWeight: 'bold' }}>Current Location</div>
                    <div>{node.long_name}</div>
                  </Popup>
                </Marker>
                
                {/* Heard From neighbors */}
                {neighbors?.heard_from
                  .filter(n => n.node_id !== node.node_id)
                  .map(neighbor => {
                    const neighborNode = nodeLookup?.getNode(neighbor.node_id);
                    if (!neighborNode?.last_lat || !neighborNode?.last_long || 
                        neighborNode.last_lat === 0 || neighborNode.last_long === 0) {
                      return null;
                    }
                    const lat = neighborNode.last_lat / COORDINATE_SCALE_FACTOR;
                    const lng = neighborNode.last_long / COORDINATE_SCALE_FACTOR;
                    return (
                      <Marker
                        key={`heard-from-${neighbor.node_id}`}
                        position={[lat, lng]}
                        icon={HeardFromIcon}
                      >
                        <Popup>
                          <div style={{ fontWeight: 'bold' }}>Heard From</div>
                          <div>{neighborNode.long_name || formatNodeId(neighbor.node_id)}</div>
                          <div style={{ fontSize: '0.9em', color: '#666' }}>
                            {neighbor.packet_count} packets
                          </div>
                        </Popup>
                      </Marker>
                    );
                  })}
                
                {/* Heard By neighbors */}
                {neighbors?.heard_by
                  .filter(n => n.node_id !== node.node_id)
                  .map(neighbor => {
                    const neighborNode = nodeLookup?.getNode(neighbor.node_id);
                    if (!neighborNode?.last_lat || !neighborNode?.last_long || 
                        neighborNode.last_lat === 0 || neighborNode.last_long === 0) {
                      return null;
                    }
                    const lat = neighborNode.last_lat / COORDINATE_SCALE_FACTOR;
                    const lng = neighborNode.last_long / COORDINATE_SCALE_FACTOR;
                    return (
                      <Marker
                        key={`heard-by-${neighbor.node_id}`}
                        position={[lat, lng]}
                        icon={HeardByIcon}
                      >
                        <Popup>
                          <div style={{ fontWeight: 'bold' }}>Heard By</div>
                          <div>{neighborNode.long_name || formatNodeId(neighbor.node_id)}</div>
                          <div style={{ fontSize: '0.9em', color: '#666' }}>
                            {neighbor.packet_count} packets
                          </div>
                        </Popup>
                      </Marker>
                    );
                  })}
                
                {filteredHistoricalPositions.map((position, idx) => (
                  <Marker 
                    key={`${position.lat},${position.lng}-${idx}`}
                    position={[position.lat, position.lng]}
                    icon={HistoricalIcon}
                  >
                    <Popup>{renderHistoricalPopup(position)}</Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
            <button 
              className="map-expand-button"
              onClick={() => {
                const willExpand = !mapExpanded;
                setMapExpanded(willExpand);
                if (willExpand && mapCardRef.current) {
                  setTimeout(() => {
                    mapCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 100);
                }
              }}
              title={mapExpanded ? "Collapse map" : "Expand map"}
            >
              {mapExpanded ? (
                <>
                  <span>Collapse</span>
                  <span style={{ marginLeft: '0.5rem' }}>▲</span>
                </>
              ) : (
                <>
                  <span>Expand</span>
                  <span style={{ marginLeft: '0.5rem' }}>▼</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Tabbed interface for Neighbors, Recent Packets, and Packets Heard */}
        <div className="node-tabs-container">
          <div className="node-tabs">
            <button
              className={activeTab === 'neighbors' ? 'tab-active' : ''}
              onClick={() => switchTab('neighbors')}
            >
              Neighbors
            </button>
            <button
              className={activeTab === 'packets' ? 'tab-active' : ''}
              onClick={() => switchTab('packets')}
            >
              Recent Packets
            </button>
            <button
              className={activeTab === 'heard' ? 'tab-active' : ''}
              onClick={() => switchTab('heard')}
            >
              Packets Heard
            </button>
          </div>

          {/* Neighbors Tab */}
          {activeTab === 'neighbors' && (
            <div className="tab-content">
              {neighborsLoading ? (
                <div className="neighbors-loading">Loading neighbors...</div>
              ) : neighbors ? (
                <div className="neighbors-grid">
                  {neighbors.heard_from.length > 0 && (
                    <div className="neighbors-section">
                      <h4>Heard From ({neighbors.heard_from.filter(n => n.node_id !== node.node_id).length})</h4>
                      <table className="neighbors-table">
                        <thead>
                          <tr>
                            <th>Node</th>
                            <th>Relay ID</th>
                            <th>Packets</th>
                          </tr>
                        </thead>
                        <tbody>
                          {neighbors.heard_from
                            .filter(n => n.node_id !== node.node_id)
                            .sort((a, b) => b.packet_count - a.packet_count)
                            .slice(0, 25)
                            .map(neighbor => {
                              const neighborNode = nodeLookup?.getNode(neighbor.node_id);
                              return (
                                <tr key={neighbor.node_id}>
                                  <td>
                                    <button 
                                      className="node-link"
                                      onClick={() => onNodeClick(formatNodeId(neighbor.node_id))}
                                    >
                                      {neighborNode?.long_name || formatNodeId(neighbor.node_id)}
                                    </button>
                                  </td>
                                  <td>{neighbor.node_id & 255}</td>
                                  <td>{neighbor.packet_count}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                      {neighbors.heard_from.filter(n => n.node_id !== node.node_id).length > 25 && (
                        <div className="neighbors-more">...and {neighbors.heard_from.filter(n => n.node_id !== node.node_id).length - 25} more</div>
                      )}
                    </div>
                  )}
                  {neighbors.heard_by.length > 0 && (
                    <div className="neighbors-section">
                      <h4>Heard By ({neighbors.heard_by.filter(n => n.node_id !== node.node_id).length})</h4>
                      <table className="neighbors-table">
                        <thead>
                          <tr>
                            <th>Node</th>
                            <th>Relay ID</th>
                            <th>Packets</th>
                          </tr>
                        </thead>
                        <tbody>
                          {neighbors.heard_by
                            .filter(n => n.node_id !== node.node_id)
                            .sort((a, b) => b.packet_count - a.packet_count)
                            .slice(0, 25)
                            .map(neighbor => {
                              const neighborNode = nodeLookup?.getNode(neighbor.node_id);
                              return (
                                <tr key={neighbor.node_id}>
                                  <td>
                                    <button 
                                      className="node-link"
                                      onClick={() => onNodeClick(formatNodeId(neighbor.node_id))}
                                    >
                                      {neighborNode?.long_name || formatNodeId(neighbor.node_id)}
                                    </button>
                                  </td>
                                  <td>{neighbor.node_id & 255}</td>
                                  <td>{neighbor.packet_count}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                      {neighbors.heard_by.filter(n => n.node_id !== node.node_id).length > 25 && (
                        <div className="neighbors-more">...and {neighbors.heard_by.filter(n => n.node_id !== node.node_id).length - 25} more</div>
                      )}
                    </div>
                  )}
                  {neighbors.heard_from.filter(n => n.node_id !== node.node_id).length === 0 && 
                   neighbors.heard_by.filter(n => n.node_id !== node.node_id).length === 0 && (
                    <div className="neighbors-empty">No neighbor data available</div>
                  )}
                </div>
              ) : (
                <div className="neighbors-error">Failed to load neighbors</div>
              )}
            </div>
          )}

          {/* Recent Packets Tab */}
          {activeTab === 'packets' && (
            <div className="tab-content">
              <div className="node-packets-header">
                <h3>Recent Packets ({filteredAndSortedPackets.length})</h3>
                <div className="packet-filter-selector">
                  <button
                    className={packetFilter === 'all' ? 'active' : ''}
                    onClick={() => setPacketFilter('all')}
                  >
                    All
                  </button>
                  <button
                    className={packetFilter === 'from' ? 'active' : ''}
                    onClick={() => setPacketFilter('from')}
                  >
                    From
                  </button>
                  <button
                    className={packetFilter === 'to' ? 'active' : ''}
                    onClick={() => setPacketFilter('to')}
                  >
                    To
                  </button>
                </div>
                <div className="port-filter-selector">
                  <label>
                    Port:
                    <select value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)}>
                      <option value="all">All</option>
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
                {filteredAndSortedPackets.map((pkt) => {
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
              <div className="no-packets">No recent packets found</div>
            )}
          </div>
        </div>
      )}

      {/* Packets Heard Tab */}
      {activeTab === 'heard' && (
        <div className="tab-content">
          <div className="node-packets-header">
            <h3>Packets Heard ({heardPackets.length})</h3>
          </div>
          {heardPacketsLoading ? (
            <div className="packets-loading">Loading packets heard...</div>
          ) : (
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
                    <th>Gateways</th>
                  </tr>
                </thead>
                <tbody>
                  {heardPackets.map((pkt) => {
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
              {heardPackets.length === 0 && (
                <div className="no-packets">No packets heard</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
      </div>
    </div>
  );
}
