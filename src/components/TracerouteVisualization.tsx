import { useMemo } from 'react';
import { formatNodeId, getNodeDisplayName } from '../utils/portNames';
import type { NodeLookup } from '../utils/nodeLookup';

interface TracerouteVisualizationProps {
  packetId: number;
  route: number[]; // Array of node IDs in the route
  fromNodeId: number;
  toNodeId: number;
  isDone: boolean; // Whether the traceroute reached its destination
  nodeLookup: NodeLookup | null;
  onNodeClick: (nodeId: string) => void;
}

export function TracerouteVisualization({ 
  route, 
  fromNodeId, 
  toNodeId,
  isDone,
  nodeLookup, 
  onNodeClick 
}: TracerouteVisualizationProps) {
  const nodes = useMemo(() => {
    // Create full path: from -> route nodes -> (optionally) to
    const fullPath = isDone ? [fromNodeId, ...route, toNodeId] : [fromNodeId, ...route];
    // Remove duplicates while preserving order
    const uniquePath: number[] = [];
    const seen = new Set<number>();
    for (const nodeId of fullPath) {
      if (!seen.has(nodeId)) {
        seen.add(nodeId);
        uniquePath.push(nodeId);
      }
    }
    return uniquePath;
  }, [route, fromNodeId, toNodeId, isDone]);

  const getNodeName = (nodeId: number): string => {
    return getNodeDisplayName(nodeId, nodeLookup);
  };

  // Calculate layout
  const nodeSpacing = 180;
  const nodeRadius = 40;
  const width = Math.max(800, nodes.length * nodeSpacing);
  const height = 300;
  const startX = 80;
  const centerY = height / 2;

  return (
    <div className="traceroute-visualization">
      <h3>Route Visualization ({nodes.length} hops)</h3>
      <div className="traceroute-svg-container">
        <svg width={width} height={height} style={{ overflow: 'visible' }}>
          {/* Draw connections */}
          <g className="traceroute-edges">
            {nodes.slice(0, -1).map((_, idx) => {
              const x1 = startX + idx * nodeSpacing;
              const x2 = startX + (idx + 1) * nodeSpacing;
              return (
                <g key={`edge-${idx}`}>
                  <line
                    x1={x1}
                    y1={centerY}
                    x2={x2}
                    y2={centerY}
                    stroke="var(--border-color-dark)"
                    strokeWidth="2"
                    markerEnd="url(#arrowhead)"
                  />
                  <text
                    x={(x1 + x2) / 2}
                    y={centerY - 10}
                    textAnchor="middle"
                    fontSize="12"
                    fill="var(--text-secondary)"
                  >
                    hop {idx + 1}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Define arrowhead marker */}
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="3"
              orient="auto"
            >
              <polygon
                points="0 0, 10 3, 0 6"
                fill="var(--border-color-dark)"
              />
            </marker>
          </defs>

          {/* Draw nodes */}
          <g className="traceroute-nodes">
            {nodes.map((nodeId, idx) => {
              const x = startX + idx * nodeSpacing;
              const isStart = idx === 0;
              const isEnd = idx === nodes.length - 1 && isDone;
              const isLastHop = idx === nodes.length - 1 && !isDone;
              const nodeName = getNodeName(nodeId);
              const nodeIdHex = formatNodeId(nodeId);

              return (
                <g
                  key={nodeId}
                  className="traceroute-node"
                  onClick={() => onNodeClick(nodeIdHex)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Node circle */}
                  <circle
                    cx={x}
                    cy={centerY}
                    r={nodeRadius}
                    fill={isStart ? '#4CAF50' : isEnd ? '#2196F3' : isLastHop ? '#ef4444' : '#FF9800'}
                    stroke="#fff"
                    strokeWidth="3"
                    className="traceroute-node-circle"
                  />
                  
                  {/* Node label */}
                  <text
                    x={x}
                    y={centerY + 5}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="bold"
                    fill="#fff"
                    pointerEvents="none"
                  >
                    {isStart ? 'FROM' : isEnd ? 'TO' : isLastHop ? 'END' : idx}
                  </text>

                  {/* Node name below */}
                  <text
                    x={x}
                    y={centerY + nodeRadius + 20}
                    textAnchor="middle"
                    fontSize="13"
                    fontWeight="500"
                    fill="var(--text-primary)"
                    pointerEvents="none"
                  >
                    {nodeName.length > 15 ? nodeName.substring(0, 13) + '...' : nodeName}
                  </text>

                  {/* Node ID below name */}
                  <text
                    x={x}
                    y={centerY + nodeRadius + 38}
                    textAnchor="middle"
                    fontSize="11"
                    fill="var(--text-secondary)"
                    pointerEvents="none"
                  >
                    {nodeIdHex}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
