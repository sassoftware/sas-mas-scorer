// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import Dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';
import type { SidNodeData } from '../types/sid';
import { NODE_DIMENSIONS } from './constants';
import type { NodeGroup } from './sidToReactFlow';

interface LayoutOptions {
  rankdir?: 'TB' | 'LR';
  ranksep?: number;
  nodesep?: number;
}

const GROUP_PADDING = 30;
const GROUP_LABEL_HEIGHT = 28;

export interface GroupBox {
  id: string;
  label: string;
  type: 'sub-decision' | 'parallel';
  x: number;
  y: number;
  width: number;
  height: number;
}

export function layoutGraph(
  nodes: Node<SidNodeData>[],
  edges: Edge[],
  groups: NodeGroup[] = [],
  options: LayoutOptions = {},
): { nodes: Node<SidNodeData>[]; edges: Edge[]; groupBoxes: GroupBox[] } {
  const { rankdir = 'TB', ranksep = 80, nodesep = 50 } = options;

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir,
    ranksep,
    nodesep,
    marginx: 20,
    marginy: 20,
  });

  for (const node of nodes) {
    const dims = NODE_DIMENSIONS[node.data.nodeType] ?? NODE_DIMENSIONS.unknown;
    g.setNode(node.id, { width: dims.width, height: dims.height });
  }

  for (const edge of edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  Dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) return node;
    const dims = NODE_DIMENSIONS[node.data.nodeType] ?? NODE_DIMENSIONS.unknown;
    return {
      ...node,
      position: {
        x: pos.x - dims.width / 2,
        y: pos.y - dims.height / 2,
      },
    };
  });

  const nodeMap = new Map<string, Node<SidNodeData>>();
  for (const n of layoutedNodes) {
    nodeMap.set(n.id, n);
  }

  const groupBoxes: GroupBox[] = [];
  for (const group of groups) {
    if (group.nodeIds.length === 0) continue;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const nid of group.nodeIds) {
      const n = nodeMap.get(nid);
      if (!n) continue;
      const dims = NODE_DIMENSIONS[n.data.nodeType] ?? NODE_DIMENSIONS.unknown;
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + dims.width);
      maxY = Math.max(maxY, n.position.y + dims.height);
    }

    if (!isFinite(minX)) continue;

    groupBoxes.push({
      id: group.id,
      label: group.label,
      type: group.type,
      x: minX - GROUP_PADDING,
      y: minY - GROUP_PADDING - GROUP_LABEL_HEIGHT,
      width: (maxX - minX) + GROUP_PADDING * 2,
      height: (maxY - minY) + GROUP_PADDING * 2 + GROUP_LABEL_HEIGHT,
    });
  }

  return { nodes: layoutedNodes, edges, groupBoxes };
}
