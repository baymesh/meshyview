/**
 * Parse traceroute payload from hex string
 * Traceroute packets contain a list of node IDs that the packet traveled through
 * 
 * Based on the Meshtastic protobuf definition:
 * message RouteDiscovery {
 *   repeated fixed32 route = 1; // Node IDs in the route (little-endian 32-bit)
 * }
 */

export interface TracerouteData {
  route: number[]; // Array of node IDs in the route (intermediate hops)
}

/**
 * Parse traceroute payload from hex string
 * The payload contains protobuf-encoded route data
 */
export function parseTraceroutePayload(payloadHex: string): TracerouteData | null {
  try {
    if (!payloadHex || payloadHex.length === 0) {
      return null;
    }

    // Convert hex string to byte array
    const bytes: number[] = [];
    for (let i = 0; i < payloadHex.length; i += 2) {
      bytes.push(parseInt(payloadHex.substr(i, 2), 16));
    }

    const route: number[] = [];
    let i = 0;

    // Parse protobuf wire format
    // Field 1 (route) is repeated fixed32
    while (i < bytes.length) {
      const fieldHeader = bytes[i];
      i++;

      if (fieldHeader === undefined) break;

      const fieldNumber = fieldHeader >> 3;
      const wireType = fieldHeader & 0x07;

      // Field 1 is the route (repeated fixed32)
      // Wire type 5 = 32-bit (fixed32)
      if (fieldNumber === 1 && wireType === 5) {
        // Read 4 bytes (little-endian fixed32)
        if (i + 4 <= bytes.length) {
          const nodeId = 
            bytes[i] | 
            (bytes[i + 1] << 8) | 
            (bytes[i + 2] << 16) | 
            (bytes[i + 3] << 24);
          route.push(nodeId >>> 0); // Convert to unsigned
          i += 4;
        } else {
          break;
        }
      } else if (wireType === 0) {
        // Varint - skip it
        while (i < bytes.length && bytes[i] >= 0x80) {
          i++;
        }
        i++; // Skip last byte
      } else if (wireType === 1) {
        // 64-bit - skip 8 bytes
        i += 8;
      } else if (wireType === 2) {
        // Length-delimited - read length and skip
        let length = 0;
        let shift = 0;
        while (i < bytes.length) {
          const b = bytes[i++];
          length |= (b & 0x7f) << shift;
          if ((b & 0x80) === 0) break;
          shift += 7;
        }
        i += length;
      } else if (wireType === 5) {
        // 32-bit - skip 4 bytes (if not our field)
        i += 4;
      }
    }

    return { route };
  } catch (error) {
    console.error('Error parsing traceroute payload:', error);
    return null;
  }
}
