// Common constants used across the application

// Meshtastic coordinate scale factor (coords are stored as integers * 10^7)
export const COORDINATE_SCALE_FACTOR = 10000000;

// Port number to name mapping based on Meshtastic protocol
// Reference: https://buf.build/meshtastic/protobufs/docs/main:meshtastic#meshtastic.PortNum
export const PORT_NUM_NAMES: Record<string, string> = {
  '0': 'UNKNOWN_APP',
  '1': 'TEXT_MESSAGE_APP',
  '2': 'REMOTE_HARDWARE_APP',
  '3': 'POSITION_APP',
  '4': 'NODEINFO_APP',
  '5': 'ROUTING_APP',
  '6': 'ADMIN_APP',
  '7': 'TEXT_MESSAGE_COMPRESSED_APP',
  '8': 'WAYPOINT_APP',
  '9': 'AUDIO_APP',
  '10': 'DETECTION_SENSOR_APP',
  '32': 'REPLY_APP',
  '33': 'IP_TUNNEL_APP',
  '34': 'PAXCOUNTER_APP',
  '64': 'SERIAL_APP',
  '65': 'STORE_FORWARD_APP',
  '66': 'RANGE_TEST_APP',
  '67': 'TELEMETRY_APP',
  '68': 'ZPS_APP',
  '69': 'SIMULATOR_APP',
  '70': 'TRACEROUTE_APP',
  '71': 'NEIGHBORINFO_APP',
  '72': 'ATAK_PLUGIN',
  '73': 'MAP_REPORT_APP',
  '256': 'PRIVATE_APP',
  '257': 'ATAK_FORWARDER',
};

// Port number for position packets
export const POSITION_PORTNUM = 3;

// Port number for text message packets
export const TEXT_MESSAGE_PORTNUM = 1;

// Port number for traceroute packets
export const TRACEROUTE_PORTNUM = 70;

// Port number for neighbor info packets
export const NEIGHBORINFO_PORTNUM = 71;

// Special node IDs
export const BROADCAST_NODE_ID = 0xffffffff; // 4294967295

// WebSocket base URL
export const WEBSOCKET_URL = 'wss://meshql.bayme.sh/ws';

// Default map zoom levels
export const MAP_DEFAULT_ZOOM = 10;
export const MAP_NODE_DETAIL_ZOOM = 13;

// Default fetch limits
export const DEFAULT_NODE_LIMIT = 1000;
export const DEFAULT_PACKET_LIMIT = 500;
export const DEFAULT_CHAT_LIMIT = 100;
export const DEFAULT_NEIGHBOR_DISPLAY_LIMIT = 25;

// Map heights
export const MAP_HEIGHT_COLLAPSED = 300;
export const MAP_HEIGHT_EXPANDED = 800;
export const PACKET_MAP_HEIGHT_COLLAPSED = 400;
export const MAIN_MAP_HEIGHT_COLLAPSED = 600;
export const MAIN_MAP_HEIGHT_EXPANDED = 900;
