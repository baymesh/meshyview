import { MapContainer, TileLayer, Marker, Popup, useMap, LayersControl, Polyline } from 'react-leaflet';
import { useEffect, useState } from 'react';
import L from 'leaflet';
import type { Node, NodeGraphEdge } from '../types';
import { api } from '../api';
import { MAIN_MAP_HEIGHT_COLLAPSED, MAIN_MAP_HEIGHT_EXPANDED } from '../utils/constants';
import 'leaflet/dist/leaflet.css';

const { BaseLayer } = LayersControl;

// Fix for default marker icons in webpack
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

// Set default icon for all markers
L.Marker.prototype.options.icon = DefaultIcon;

interface MeshMapProps {
  nodes: Node[];
  onNodeClick?: (nodeId: string) => void;
  recentlyUpdatedNodes?: Map<number, number>; // node_id -> timestamp
  showConnections?: boolean;
  connectionChannel?: string;
  connectionHours?: number;
}

// Meshtastic stores coordinates as integers (lat/lon * 10^7)
const COORDINATE_SCALE_FACTOR = 10000000;

// Default center (Bay Area)
const DEFAULT_CENTER: [number, number] = [37.557593, -122.006219];

// Component to handle map view adjustments
function MapViewController({ nodes }: { nodes: Node[] }) {
  const map = useMap();
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [geolocationAttempted, setGeolocationAttempted] = useState(false);
  const [initialViewSet, setInitialViewSet] = useState(false);

  // Get user's geolocation on mobile
  useEffect(() => {
    if (geolocationAttempted) return;
    
    // Only attempt geolocation on mobile devices
    const isMobile = window.innerWidth <= 768;
    if (!isMobile) {
      setGeolocationAttempted(true);
      return;
    }

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation([latitude, longitude]);
          setGeolocationAttempted(true);
        },
        (error) => {
          console.log('Geolocation not available or denied:', error.message);
          setGeolocationAttempted(true);
        },
        {
          timeout: 5000,
          enableHighAccuracy: false
        }
      );
    } else {
      setGeolocationAttempted(true);
    }
  }, [geolocationAttempted]);

  // Adjust map view based on nodes and user location - only on initial load
  useEffect(() => {
    if (!geolocationAttempted || initialViewSet) return;

    // Convert coordinates from integers to decimal degrees
    const convertCoordinates = (lat: number, lon: number): [number, number] => {
      return [lat / COORDINATE_SCALE_FACTOR, lon / COORDINATE_SCALE_FACTOR];
    };

    const nodesWithLocation = nodes.filter(
      (node) => node.last_lat !== null && node.last_long !== null
    );

    if (nodesWithLocation.length > 0) {
      // Create bounds from all node positions
      const bounds = L.latLngBounds(
        nodesWithLocation.map((node) => 
          convertCoordinates(node.last_lat!, node.last_long!)
        )
      );
      
      // Fit bounds with padding
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 13 });
      setInitialViewSet(true);
    } else if (userLocation) {
      // If no nodes but we have user location, center on user
      map.setView(userLocation, 11);
      setInitialViewSet(true);
    } else if (nodes.length === 0) {
      // Fall back to default center only if no nodes at all
      map.setView(DEFAULT_CENTER, 9);
      setInitialViewSet(true);
    }
  }, [map, nodes, userLocation, geolocationAttempted, initialViewSet]);

  return null;
}

export function MeshMap({ 
  nodes, 
  onNodeClick, 
  recentlyUpdatedNodes,
  showConnections = false,
  connectionChannel = 'MediumFast',
  connectionHours = 24
}: MeshMapProps) {
  const [, forceUpdate] = useState({});
  const [connections, setConnections] = useState<NodeGraphEdge[]>([]);
  const [mapExpanded, setMapExpanded] = useState(false);
  
  // Force re-render every second to update glow effect
  useEffect(() => {
    if (!recentlyUpdatedNodes || recentlyUpdatedNodes.size === 0) return;
    
    const interval = setInterval(() => {
      forceUpdate({});
    }, 1000); // Update every second for smooth fade
    
    return () => clearInterval(interval);
  }, [recentlyUpdatedNodes]);

  // Fetch node connections when requested
  useEffect(() => {
    if (!showConnections) {
      setConnections([]);
      return;
    }

    const fetchConnections = async () => {
      try {
        const graphData = await api.getNodeGraph({
          channel: connectionChannel,
          with_location: true,
          hours: connectionHours
        });
        setConnections(graphData.edges);
      } catch (err) {
        console.error('Error fetching node connections:', err);
        setConnections([]);
      }
    };

    fetchConnections();
  }, [showConnections, connectionChannel, connectionHours]);
  
  // Filter nodes with valid coordinates
  const nodesWithLocation = nodes.filter(
    (node) => node.last_lat !== null && node.last_long !== null
  );

  // Create a map of node_id to coordinates for drawing connections
  const nodeCoordinates = new Map<number, [number, number]>();
  nodesWithLocation.forEach((node) => {
    const coords: [number, number] = [
      node.last_lat! / COORDINATE_SCALE_FACTOR,
      node.last_long! / COORDINATE_SCALE_FACTOR
    ];
    nodeCoordinates.set(node.node_id, coords);
  });

  // Convert coordinates from integers to decimal degrees
  const convertCoordinates = (lat: number, lon: number): [number, number] => {
    return [lat / COORDINATE_SCALE_FACTOR, lon / COORDINATE_SCALE_FACTOR];
  };

  // Get role color
  const getRoleColor = (role: string): string => {
    const colors: Record<string, string> = {
      'ROUTER': '#ff4444',
      'ROUTER_CLIENT': '#ff8844',
      'CLIENT': '#4444ff',
      'CLIENT_BASE': '#44ff44',
      'REPEATER': '#ff44ff',
      'TRACKER': '#ffff44',
      'SENSOR': '#44ffff',
    };
    return colors[role] || '#888888';
  };

  // Calculate glow opacity based on time since update
  const getGlowOpacity = (nodeId: number): number => {
    if (!recentlyUpdatedNodes) return 0;
    const updateTime = recentlyUpdatedNodes.get(nodeId);
    if (!updateTime) return 0;
    
    const elapsed = Date.now() - updateTime;
    const maxDuration = 60000; // 60 seconds
    
    if (elapsed >= maxDuration) return 0;
    
    // Fade from 1 to 0 over 60 seconds
    return 1 - (elapsed / maxDuration);
  };

  // Create custom icons based on role and update status
  const createCustomIcon = (role: string, nodeId: number) => {
    const color = getRoleColor(role);
    const glowOpacity = getGlowOpacity(nodeId);
    
    const glowStyle = glowOpacity > 0 
      ? `box-shadow: 0 0 20px rgba(255, 255, 0, ${glowOpacity}), 0 0 40px rgba(255, 255, 0, ${glowOpacity * 0.5}), 0 2px 4px rgba(0,0,0,0.3);`
      : 'box-shadow: 0 2px 4px rgba(0,0,0,0.3);';
    
    return L.divIcon({
      className: 'custom-marker',
      html: `<div style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; ${glowStyle}"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -10],
    });
  };

  return (
    <div className="mesh-map-container">
      <div className="mesh-map-wrapper">
        <MapContainer
          key={`${nodes.length}-${mapExpanded}`}
          center={DEFAULT_CENTER}
          zoom={9}
          style={{ height: mapExpanded ? `${MAIN_MAP_HEIGHT_EXPANDED}px` : `${MAIN_MAP_HEIGHT_COLLAPSED}px`, width: '100%' }}
        >
            <MapViewController nodes={nodes} />
            
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

            {/* Draw connection lines between nodes */}
            {showConnections && connections.map((edge, index) => {
              const sourceCoords = nodeCoordinates.get(edge.source);
              const targetCoords = nodeCoordinates.get(edge.target);
              
              if (!sourceCoords || !targetCoords) return null;
              
              // Calculate line opacity based on packet count (more packets = more opaque)
              const maxPackets = Math.max(...connections.map(e => e.packet_count));
              const opacity = Math.min(0.3 + (edge.packet_count / maxPackets) * 0.7, 1);
              
              // Calculate line width based on packet count
              const weight = Math.min(1 + (edge.packet_count / maxPackets) * 4, 5);
              
              return (
                <Polyline
                  key={`connection-${edge.source}-${edge.target}-${index}`}
                  positions={[sourceCoords, targetCoords]}
                  pathOptions={{
                    color: '#007bff',
                    weight: weight,
                    opacity: opacity,
                    dashArray: '5, 5', // Dashed line to distinguish from roads
                  }}
                />
              );
            })}

            {/* Draw markers */}
            {nodesWithLocation.map((node) => {
              const [lat, lon] = convertCoordinates(node.last_lat!, node.last_long!);
              return (
                <Marker 
                  key={node.id} 
                  position={[lat, lon]}
                  icon={createCustomIcon(node.role, node.node_id)}
                >
                  <Popup>
                    <div style={{ minWidth: '200px' }}>
                      <h3 style={{ margin: '0 0 8px 0', fontSize: '16px' }}>{node.long_name}</h3>
                      <div style={{ fontSize: '13px' }}>
                        <p style={{ margin: '4px 0' }}><strong>ID:</strong> {node.id}</p>
                        <p style={{ margin: '4px 0' }}><strong>Short Name:</strong> {node.short_name}</p>
                        <p style={{ margin: '4px 0' }}><strong>Role:</strong> {node.role}</p>
                        <p style={{ margin: '4px 0' }}><strong>Hardware:</strong> {node.hw_model}</p>
                        {node.firmware && (
                          <p style={{ margin: '4px 0' }}><strong>Firmware:</strong> {node.firmware}</p>
                        )}
                        <p style={{ margin: '4px 0' }}><strong>Channel:</strong> {node.channel}</p>
                        <p style={{ margin: '4px 0' }}><strong>Last Update:</strong> {new Date(node.last_update).toLocaleString()}</p>
                      </div>
                      {onNodeClick && (
                        <button
                          onClick={() => onNodeClick(node.id)}
                          style={{
                            marginTop: '8px',
                            padding: '6px 12px',
                            backgroundColor: '#007bff',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            width: '100%'
                          }}
                        >
                          View Details →
                        </button>
                      )}
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
      </div>
      <button 
        className="map-expand-button"
        onClick={() => {
          const willExpand = !mapExpanded;
          setMapExpanded(willExpand);
          if (willExpand) {
            // Scroll to the top of the map when expanding
            setTimeout(() => {
              const mapElement = document.querySelector('.mesh-map-container');
              if (mapElement) {
                mapElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
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
  );
}