import type { Node } from '../types';
import { formatNodeId } from './portNames';

export class NodeLookup {
  private nodeMap: Map<string, Node> = new Map();

  constructor(nodes: Node[]) {
    this.updateNodes(nodes);
  }

  updateNodes(nodes: Node[]): void {
    this.nodeMap.clear();
    nodes.forEach(node => {
      // Store by hex ID
      const hexId = formatNodeId(node.node_id);
      this.nodeMap.set(hexId, node);
      // Also store by numeric ID as string
      this.nodeMap.set(node.node_id.toString(), node);
    });
  }

  getNodeName(nodeId: number | string): string {
    const id = typeof nodeId === 'number' ? formatNodeId(nodeId) : nodeId;
    const node = this.nodeMap.get(id);
    if (node) {
      return node.long_name || node.short_name || id;
    }
    return id;
  }

  getNode(nodeId: number | string): Node | undefined {
    const id = typeof nodeId === 'number' ? formatNodeId(nodeId) : nodeId;
    return this.nodeMap.get(id);
  }
}
