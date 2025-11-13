import { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../api';
import { formatNodeId, formatLocalDateTime } from '../utils/portNames';
import type { NodeLookup } from '../utils/nodeLookup';

interface TracerouteDetailProps {
  packetId: number;
  nodeLookup: NodeLookup | null;
  onBack: () => void;
  onNodeClick: (nodeId: string) => void;
}

interface TraceroutePacket {
  id: number;
  packet_id: number;
  gateway_node_id: number;
  done: boolean;
  import_time: string;
  route: {
    type: string;
    route: number[];
    raw_hex?: string;
  };
  route_hex: string;
}

interface TracerouteData {
  packet_id: number;
  traceroutes: TraceroutePacket[];
}

interface GraphNode {
  id: number;
  name: string;
  x: number;
  y: number;
  type: 'source' | 'destination' | 'intermediate' | 'gateway';
  count: number; // How many routes pass through this node
}

interface GraphEdge {
  from: number;
  to: number;
  count: number; // How many times this connection appears
}

export function TracerouteDetail({ packetId, nodeLookup, onBack, onNodeClick }: TracerouteDetailProps) {
  const [data, setData] = useState<TracerouteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceNode, setSourceNode] = useState<number | null>(null);
  const [destNode, setDestNode] = useState<number | null>(null);

  useEffect(() => {
    const fetchTracerouteData = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.getTracerouteDetail(packetId);
        
        setData(result);

        // Get source and dest from the original packet
        const packetDetail = await api.getPacketDetail(packetId, { decode_payload: true });
        setSourceNode(packetDetail.from_node_id);
        setDestNode(packetDetail.to_node_id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch traceroute data');
        console.error('Error fetching traceroute data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTracerouteData();
  }, [packetId]);

  const getNodeName = (nodeId: number): string => {
    if (!nodeLookup) return formatNodeId(nodeId);
    return nodeLookup.getNodeName(nodeId);
  };

  // Deduplicate routes - group by identical path
  const uniqueRoutes = useMemo(() => {
    if (!data) return [];

    const routeMap = new Map<string, {
      route: TraceroutePacket;
      gateways: number[];
      count: number;
      completed: boolean;
    }>();

    data.traceroutes.forEach(tr => {
      if (!tr.route?.route) return;
      
      // Create a key from the route path + completion status
      const routeKey = `${tr.done ? 'complete' : 'incomplete'}:${tr.route.route.join(',')}`;
      
      if (routeMap.has(routeKey)) {
        const existing = routeMap.get(routeKey)!;
        existing.gateways.push(tr.gateway_node_id);
        existing.count++;
      } else {
        routeMap.set(routeKey, {
          route: tr,
          gateways: [tr.gateway_node_id],
          count: 1,
          completed: tr.done
        });
      }
    });

    return Array.from(routeMap.values()).sort((a, b) => {
      // Sort completed routes first
      if (a.completed !== b.completed) return a.completed ? -1 : 1;
      // Then by hop count (direct first, then by number of hops)
      const aHops = a.route.route?.route?.length || 0;
      const bHops = b.route.route?.route?.length || 0;
      if (aHops !== bHops) return aHops - bHops;
      // Then by count (most observed first)
      return b.count - a.count;
    });
  }, [data]);

  // Separate completed and incomplete routes
  const completedRoutes = uniqueRoutes.filter(r => r.completed);

  // Build comprehensive graph from all routes
  const { nodes: graphNodes, edges: graphEdges } = useRef<{ nodes: GraphNode[], edges: GraphEdge[] }>({
    nodes: [],
    edges: []
  }).current;

  useEffect(() => {
    if (!data || !sourceNode || !destNode) return;

    const nodeMap = new Map<number, GraphNode>();
    const edgeMap = new Map<string, GraphEdge>();
    const nodesOnCompletedRoutes = new Set<number>();

    // Track which nodes appear on completed routes
    data.traceroutes.forEach(tr => {
      if (tr.done && tr.route?.route) {
        // Only add the actual route hops, not the gateway or source/dest
        tr.route.route.forEach(nodeId => nodesOnCompletedRoutes.add(nodeId));
      }
    });

    // Add source and destination
    nodeMap.set(sourceNode, {
      id: sourceNode,
      name: getNodeName(sourceNode),
      x: 0,
      y: 0,
      type: 'source',
      count: data.traceroutes.length
    });

    nodeMap.set(destNode, {
      id: destNode,
      name: getNodeName(destNode),
      x: 0,
      y: 0,
      type: 'destination',
      count: data.traceroutes.length
    });

    // Process all traceroutes for the graph (both completed and incomplete)
    data.traceroutes.forEach(tr => {
      // Skip if route data is missing
      if (!tr.route || !tr.route.route) return;

      // Add gateway node
      if (!nodeMap.has(tr.gateway_node_id)) {
        const nodeType = nodesOnCompletedRoutes.has(tr.gateway_node_id) ? 'intermediate' : 'gateway';
        nodeMap.set(tr.gateway_node_id, {
          id: tr.gateway_node_id,
          name: getNodeName(tr.gateway_node_id),
          x: 0,
          y: 0,
          type: nodeType,
          count: 0
        });
      }
      const gwNode = nodeMap.get(tr.gateway_node_id)!;
      gwNode.count++;

      // Build full path: source -> route nodes -> dest (only if done)
      const routeHops = tr.route.route;
      const fullPath = tr.done
        ? (routeHops.length > 0 
            ? [sourceNode, ...routeHops, destNode]
            : [sourceNode, destNode])
        : (routeHops.length > 0
            ? [sourceNode, ...routeHops]  // Don't include destNode for incomplete routes
            : [sourceNode]);

      // Add all nodes in the route
      routeHops.forEach(nodeId => {
        if (!nodeMap.has(nodeId)) {
          // Determine type: if this node is on any completed route, it's intermediate, otherwise gateway
          const nodeType = nodesOnCompletedRoutes.has(nodeId) ? 'intermediate' : 'gateway';
          nodeMap.set(nodeId, {
            id: nodeId,
            name: getNodeName(nodeId),
            x: 0,
            y: 0,
            type: nodeType,
            count: 0
          });
        }
        const node = nodeMap.get(nodeId)!;
        node.count++;
      });

      // Add edges
      for (let i = 0; i < fullPath.length - 1; i++) {
        const from = fullPath[i];
        const to = fullPath[i + 1];
        const edgeKey = `${from}-${to}`;

        if (!edgeMap.has(edgeKey)) {
          edgeMap.set(edgeKey, { from, to, count: 0 });
        }
        const edge = edgeMap.get(edgeKey)!;
        edge.count++;
      }
    });

    // Calculate layout
    const allNodes = Array.from(nodeMap.values());
    const layers = calculateLayeredLayout(allNodes, Array.from(edgeMap.values()), sourceNode, destNode);
    
    graphNodes.length = 0;
    graphNodes.push(...layers.flat());
    graphEdges.length = 0;
    graphEdges.push(...Array.from(edgeMap.values()));
  }, [data, sourceNode, destNode, nodeLookup]);

  // Calculate layered layout for the graph
  function calculateLayeredLayout(
    nodes: GraphNode[], 
    edges: GraphEdge[], 
    source: number, 
    _dest: number
  ): GraphNode[][] {
    const layers: Map<number, Set<number>> = new Map();
    const visited = new Set<number>();
    const nodeToLayer = new Map<number, number>();

    // BFS to assign layers
    const queue: { id: number; layer: number }[] = [{ id: source, layer: 0 }];
    visited.add(source);
    nodeToLayer.set(source, 0);

    while (queue.length > 0) {
      const { id, layer } = queue.shift()!;
      
      if (!layers.has(layer)) {
        layers.set(layer, new Set());
      }
      layers.get(layer)!.add(id);

      // Find outgoing edges
      const outgoing = edges.filter(e => e.from === id);
      outgoing.forEach(edge => {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          const newLayer = layer + 1;
          nodeToLayer.set(edge.to, newLayer);
          queue.push({ id: edge.to, layer: newLayer });
        }
      });
    }

    // Position nodes
    const layerSpacing = 200;
    const nodeSpacing = 100;
    const result: GraphNode[][] = [];

    const sortedLayers = Array.from(layers.keys()).sort((a, b) => a - b);
    sortedLayers.forEach((layerNum, layerIdx) => {
      const layerNodes = Array.from(layers.get(layerNum)!);
      const layerNodeObjects: GraphNode[] = [];

      layerNodes.forEach((nodeId, idx) => {
        const node = nodes.find(n => n.id === nodeId)!;
        node.x = 100 + layerIdx * layerSpacing;
        node.y = 100 + idx * nodeSpacing;
        layerNodeObjects.push(node);
      });

      result.push(layerNodeObjects);
    });

    return result;
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '500px', gap: '1rem' }}>
        <div className="spinner" style={{ width: '40px', height: '40px', border: '4px solid var(--border-color)', borderTopColor: 'var(--primary-color)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
        <div style={{ color: 'var(--text-secondary)' }} role="status" aria-live="polite">Loading traceroute details...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="traceroute-detail-error">
        <button onClick={onBack} className="btn-secondary" aria-label="Go back">← Back</button>
        <div className="error" role="alert">{error || 'Traceroute data not found'}</div>
      </div>
    );
  }

  const width = Math.max(1000, graphNodes.length * 150);
  const height = Math.max(600, Math.max(...graphNodes.map(n => n.y)) + 150);

  return (
    <div className="traceroute-detail">
      <div className="traceroute-detail-header">
        <button onClick={onBack} className="btn-secondary" aria-label="Go back">← Back</button>
        <h2>Traceroute Details</h2>
      </div>

      <div className="traceroute-detail-content">
        <div className="traceroute-summary">
          <h3>Summary</h3>
          <div className="info-item">
            <span className="info-label">Packet ID:</span>
            <span className="info-value">{data.packet_id}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Unique Routes:</span>
            <span className="info-value">{completedRoutes.length}</span>
          </div>
          {sourceNode && (
            <div className="info-item">
              <span className="info-label">Source:</span>
              <span className="info-value">
                <button 
                  className="node-link"
                  onClick={() => onNodeClick(formatNodeId(sourceNode))}
                >
                  {getNodeName(sourceNode)}
                </button>
              </span>
            </div>
          )}
          {destNode && (
            <div className="info-item">
              <span className="info-label">Destination:</span>
              <span className="info-value">
                <button 
                  className="node-link"
                  onClick={() => onNodeClick(formatNodeId(destNode))}
                >
                  {getNodeName(destNode)}
                </button>
              </span>
            </div>
          )}
        </div>

        {graphNodes.length > 0 && (
          <div className="traceroute-graph-card">
            <h3>Network Graph</h3>
            <p className="graph-desc">Comprehensive view of all routes observed by gateways</p>
            <div className="traceroute-graph-container">
              <svg width={width} height={height}>
                {/* Draw edges */}
                <g className="graph-edges">
                  {graphEdges.map((edge, idx) => {
                    const fromNode = graphNodes.find(n => n.id === edge.from);
                    const toNode = graphNodes.find(n => n.id === edge.to);
                    if (!fromNode || !toNode) return null;

                    const strokeWidth = Math.min(1 + edge.count, 8);
                    const opacity = Math.min(0.3 + (edge.count * 0.2), 1);

                    return (
                      <g key={`edge-${idx}`}>
                        <line
                          x1={fromNode.x}
                          y1={fromNode.y}
                          x2={toNode.x}
                          y2={toNode.y}
                          stroke="var(--border-color-dark)"
                          strokeWidth={strokeWidth}
                          opacity={opacity}
                          markerEnd="url(#arrowhead-graph)"
                        />
                        {/* Edge counts hidden for cleaner display */}
                      </g>
                    );
                  })}
                </g>

                {/* Define arrowhead */}
                <defs>
                  <marker
                    id="arrowhead-graph"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="3"
                    orient="auto"
                  >
                    <polygon
                      points="0 0, 8 3, 0 6"
                      fill="var(--border-color-dark)"
                    />
                  </marker>
                </defs>

                {/* Draw nodes */}
                <g className="graph-nodes">
                  {graphNodes.map(node => {
                    const color = 
                      node.type === 'source' ? '#4CAF50' :
                      node.type === 'destination' ? '#ff7b7b' :
                      node.type === 'intermediate' ? '#FFB366' :
                      '#868686ff'; // light gray for nodes not on completed routes

                    // Get short name from node data if available
                    const nodeData = nodeLookup?.getNode(node.id);
                    const shortName = nodeData?.short_name || (node.name.length > 8 ? node.name.substring(0, 6) : node.name);
                    // Get full name for display below
                    const displayName = node.name.length > 12 ? node.name.substring(0, 10) + '...' : node.name;

                    return (
                      <g
                        key={node.id}
                        className="graph-node"
                        onClick={() => onNodeClick(formatNodeId(node.id))}
                        style={{ cursor: 'pointer' }}
                      >
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={40}
                          fill={color}
                          stroke="#fff"
                          strokeWidth="2"
                          opacity={0.9}
                        />
                        <text
                          x={node.x}
                          y={node.y + 5}
                          textAnchor="middle"
                          fontSize="11"
                          fontWeight="bold"
                          fill="#fff"
                        >
                          {shortName}
                        </text>
                        <text
                          x={node.x}
                          y={node.y + 55}
                          textAnchor="middle"
                          fontSize="12"
                          fontWeight="500"
                          fill="var(--text-primary)"
                        >
                          {displayName}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
            </div>
            
            {/* Color Legend */}
            <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', padding: '1rem', fontSize: '0.9rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#4CAF50' }}></div>
                <span>Source</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#FFB366' }}></div>
                <span>On Completed Route</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#ff7b7b' }}></div>
                <span>Destination</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#cccccc' }}></div>
                <span>Incomplete Route</span>
              </div>
            </div>
          </div>
        )}

        {completedRoutes.length > 0 && (
          <div className="traceroute-routes-card">
            <h3>Routes ({completedRoutes.length})</h3>
            <p className="routes-desc">Routes that successfully reached the destination</p>
            <div className="routes-list">
              {completedRoutes.map((routeGroup, idx) => {
                const tr = routeGroup.route;
                const hasHops = tr.route?.route && tr.route.route.length > 0;
                return (
                  <div key={`${tr.id}-${idx}`} className="route-item route-completed">
                    <div className="route-header">
                      <span className="route-number">Route {idx + 1}</span>
                      <span className="route-gateway">
                        observed by {routeGroup.count} gateway{routeGroup.count !== 1 ? 's' : ''}{' '}
                        {routeGroup.count <= 3 && (
                          <>
                            (
                            {routeGroup.gateways.map((gwId, gwIdx) => (
                              <span key={gwId}>
                                {gwIdx > 0 && ', '}
                                <button 
                                  className="node-link"
                                  onClick={() => onNodeClick(formatNodeId(gwId))}
                                >
                                  {getNodeName(gwId)}
                                </button>
                              </span>
                            ))}
                            )
                          </>
                        )}
                      </span>
                      {!hasHops && (
                        <span className="route-badge route-direct">Direct</span>
                      )}
                      {hasHops && (
                        <span className="route-badge route-multi-hop">{tr.route.route.length} hops</span>
                      )}
                      <span className="route-time">{formatLocalDateTime(tr.import_time)}</span>
                    </div>
                    <div className="route-path">
                      {sourceNode && (
                        <span className="route-node route-source">
                          {getNodeName(sourceNode)}
                        </span>
                      )}
                      {hasHops ? (
                        <>
                          {tr.route.route.map((nodeId, hopIdx) => (
                            <span key={hopIdx}>
                              <span className="route-arrow">→</span>
                              <button
                                className="route-node route-hop"
                                onClick={() => onNodeClick(formatNodeId(nodeId))}
                              >
                                {getNodeName(nodeId)}
                              </button>
                            </span>
                          ))}
                        </>
                      ) : (
                        <span className="route-arrow">→</span>
                      )}
                      {destNode && (
                        <>
                          {hasHops && <span className="route-arrow">→</span>}
                          <span className="route-node route-dest">
                            {getNodeName(destNode)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
