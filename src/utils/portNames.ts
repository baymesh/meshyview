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

export function getPortNumName(portnum: string): string {
  const name = PORT_NUM_NAMES[portnum];
  return name ? `${name} (${portnum})` : `Port ${portnum}`;
}

// Meshtastic broadcast address constant
export const BROADCAST_NODE_ID = 4294967295;

// Format node ID as hex without prefix
export function formatNodeId(nodeId: number): string {
  return nodeId.toString(16).padStart(8, '0');
}

// Parse node ID from various formats: !22ac3144, 22ac3144, or 581710148
// Returns the numeric node ID or null if invalid
export function parseNodeId(nodeIdStr: string): number | null {
  if (!nodeIdStr) return null;
  
  // Remove "!" prefix if present
  const cleaned = nodeIdStr.startsWith('!') ? nodeIdStr.substring(1) : nodeIdStr;
  
  // Try parsing as hex (8 characters or less)
  if (/^[0-9a-fA-F]{1,8}$/.test(cleaned)) {
    return parseInt(cleaned, 16);
  }
  
  // Try parsing as decimal
  if (/^\d+$/.test(cleaned)) {
    const num = parseInt(cleaned, 10);
    // Make sure it's a valid 32-bit unsigned integer
    if (num >= 0 && num <= 4294967295) {
      return num;
    }
  }
  
  return null;
}

// Convert UTC timestamp to local datetime string
export function formatLocalDateTime(utcTimestamp: string): string {
  // Add 'Z' suffix if not present to indicate UTC timezone
  const timestamp = utcTimestamp.endsWith('Z') ? utcTimestamp : utcTimestamp + 'Z';
  const date = new Date(timestamp);
  return date.toLocaleString();
}

// Format compact datetime for chat: [13:05] for today, [2025-10-15 13:05] for other days
export function formatCompactDateTime(utcTimestamp: string): string {
  // Add 'Z' suffix if not present to indicate UTC timezone
  const timestamp = utcTimestamp.endsWith('Z') ? utcTimestamp : utcTimestamp + 'Z';
  const date = new Date(timestamp);
  const now = new Date();
  
  // Check if the date is today (same year, month, and day)
  const isToday = date.getFullYear() === now.getFullYear() &&
                  date.getMonth() === now.getMonth() &&
                  date.getDate() === now.getDate();
  
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  
  // If today, only show time; otherwise show full date and time
  if (isToday) {
    return `[${hours}:${minutes}]`;
  } else {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `[${year}-${month}-${day} ${hours}:${minutes}]`;
  }
}
