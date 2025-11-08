import type { Node } from '../types';

interface NodesListProps {
  nodes: Node[];
  onNodeClick?: (nodeId: string) => void;
}

export function NodesList({ nodes, onNodeClick }: NodesListProps) {
  return (
    <div className="nodes-list">
      <h3>Nodes ({nodes.length})</h3>
      <div className="nodes-table-container">
        <table className="nodes-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Short</th>
              <th>Role</th>
              <th>Hardware</th>
              <th>Firmware</th>
              <th>Channel</th>
              <th>Location</th>
              <th>Last Update</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.id}>
                <td className="node-id">
                  {onNodeClick ? (
                    <button 
                      className="node-id-link"
                      onClick={() => onNodeClick(node.id)}
                    >
                      {node.id}
                    </button>
                  ) : (
                    node.id
                  )}
                </td>
                <td className="node-name">{node.long_name}</td>
                <td>{node.short_name}</td>
                <td>
                  <span className={`role-badge role-${node.role.toLowerCase()}`}>
                    {node.role}
                  </span>
                </td>
                <td>{node.hw_model}</td>
                <td>{node.firmware || 'N/A'}</td>
                <td>{node.channel}</td>
                <td>
                  {node.last_lat !== null && node.last_long !== null ? (
                    <span className="has-location">✓</span>
                  ) : (
                    <span className="no-location">✗</span>
                  )}
                </td>
                <td className="node-update">
                  {new Date(node.last_update).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
