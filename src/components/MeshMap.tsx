import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { useEffect, useState } from 'react';
import L from 'leaflet';
import type { Node } from '../types';
import 'leaflet/dist/leaflet.css';

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

  // Convert coordinates from integers to decimal degrees
  const convertCoordinates = (lat: number, lon: number): [number, number] => {
    return [lat / COORDINATE_SCALE_FACTOR, lon / COORDINATE_SCALE_FACTOR];
  };

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

  // Adjust map view based on nodes and user location
  useEffect(() => {
    if (!geolocationAttempted) return;

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
    } else if (userLocation) {
      // If no nodes but we have user location, center on user
      map.setView(userLocation, 11);
    } else {
      // Fall back to default center
      map.setView(DEFAULT_CENTER, 9);
    }
  }, [map, nodes, userLocation, geolocationAttempted]);

  return null;
}

export function MeshMap({ nodes, onNodeClick }: MeshMapProps) {
  // Filter nodes with valid coordinates
  const nodesWithLocation = nodes.filter(
    (node) => node.last_lat !== null && node.last_long !== null
  );

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

  // Create custom icons based on role
  const createCustomIcon = (role: string) => {
    const color = getRoleColor(role);
    return L.divIcon({
      className: 'custom-marker',
      html: `<div style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -10],
    });
  };

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={9}
      style={{ height: '100%', width: '100%' }}
    >
      <MapViewController nodes={nodes} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* Draw markers */}
      {nodesWithLocation.map((node) => {
        const [lat, lon] = convertCoordinates(node.last_lat!, node.last_long!);
        return (
          <Marker 
            key={node.id} 
            position={[lat, lon]}
            icon={createCustomIcon(node.role)}
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
  );
}
