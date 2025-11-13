// Common constants used across the application

// Meshtastic coordinate scale factor (coords are stored as integers * 10^7)
export const COORDINATE_SCALE_FACTOR = 10000000;

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
