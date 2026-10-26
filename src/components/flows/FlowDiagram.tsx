// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow, Controls, MiniMap, Background, BackgroundVariant, Panel,
  useNodesState, useEdgesState, type Edge, type Node, type ReactFlowInstance, type XYPosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { DecisionFlow, SidNodeData } from '../../types/sid';
import { convertFlowToGraph, type NodeGroup } from '../../flow/sidToReactFlow';
import type { RestApiDefinitionDetail } from '../../api/restApiDefinitions';
import type { RuleSetBundle } from '../../api/rulesets';
import { layoutGraph, type GroupBox } from '../../flow/layoutGraph';
import { NODE_COLORS } from '../../flow/constants';
import StartEndNode from './nodes/StartEndNode';
import DecisionNode from './nodes/DecisionNode';
import RuleSetNode from './nodes/RuleSetNode';
import ModelNode from './nodes/ModelNode';
import CodeFileNode from './nodes/CodeFileNode';
import RestApiNode from './nodes/RestApiNode';
import ConditionNode from './nodes/ConditionNode';
import GroupBoxes from './GroupBoxes';
import CollapsibleSection from './CollapsibleSection';

const nodeTypes = {
  start: StartEndNode, end: StartEndNode,
  decision: DecisionNode, custom: DecisionNode,
  ruleset: RuleSetNode, model: ModelNode,
  code_file: CodeFileNode,
  condition: ConditionNode, cond_expr: ConditionNode,
  assignment: DecisionNode, abtest: ConditionNode,
  parallel: DecisionNode, record_contact: DecisionNode,
  treatment_group: DecisionNode, segmentation_tree: DecisionNode,
  rest_api: RestApiNode,
  unknown: DecisionNode,
};

interface FlowDiagramProps {
  flow: DecisionFlow;
  subDecisionCache?: Map<string, DecisionFlow>;
  restApiCache?: Map<string, RestApiDefinitionDetail>;
  ruleSetCache?: Map<string, RuleSetBundle>;
  /**
   * The caches above are mutated in place; the page bumps this once they
   * have been filled so the graph is converted and laid out again exactly then.
   */
  cacheVersion?: number;
  onNodeClick?: (nodeData: SidNodeData) => void;
}

/** Canvas dot grid and the mini-map fallback are SVG fills, so they take literal colours (--sas-gray-200 / NODE_COLORS.unknown.border). */
const CANVAS_DOT_COLOR = '#E5E5E5';

/** Above this many nodes only the ones in view are rendered. */
const RENDER_VISIBLE_ONLY_ABOVE = 100;

/**
 * What the layout depends on: node ids and types (types fix the node size),
 * edges and groups. Badges (rule counts, REST methods) and labels do not move
 * anything, so a graph with the same signature keeps its positions.
 */
function structureSignature(nodes: Node<SidNodeData>[], edges: Edge[], groups: NodeGroup[]): string {
  return [
    nodes.map((n) => `${n.id}:${n.data.nodeType}`).join(','),
    edges.map((e) => `${e.source}>${e.target}`).join(','),
    groups.map((g) => `${g.id}:${g.nodeIds.join('+')}`).join(','),
  ].join('|');
}

interface LaidOut {
  signature: string;
  positions: Map<string, XYPosition>;
  groupBoxes: GroupBox[];
}

/** Same keys, same values (by identity): a node whose data did not change keeps its object. */
function sameData(a: SidNodeData, b: SidNodeData): boolean {
  const aKeys = Object.keys(a) as (keyof SidNodeData)[];
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => Object.is(a[key], b[key]));
}

export default function FlowDiagram({
  flow, subDecisionCache, restApiCache, ruleSetCache, cacheVersion = 0, onNodeClick,
}: FlowDiagramProps) {
  // The layout on screen. dagre runs only when the structure changes
  // (sub-decisions expanded, another flow); badge updates reuse its positions.
  const laidOutRef = useRef<LaidOut | null>(null);

  const { initialNodes, initialEdges, groupBoxes, layout, relaidOut } = useMemo(() => {
    // The caches keep their identity while they are filled in place, so the
    // page's version bump is what invalidates this memo; it is read here so
    // the dependency is a real one.
    void cacheVersion;
    const { nodes: rawNodes, edges: rawEdges, groups } = convertFlowToGraph(flow, subDecisionCache ?? new Map(), restApiCache ?? new Map(), ruleSetCache ?? new Map());
    const signature = structureSignature(rawNodes, rawEdges, groups);
    const previous = laidOutRef.current;
    if (previous && previous.signature === signature) {
      const placed = rawNodes.map((n) => ({ ...n, position: previous.positions.get(n.id) ?? n.position }));
      return { initialNodes: placed, initialEdges: rawEdges, groupBoxes: previous.groupBoxes, layout: previous, relaidOut: false };
    }
    const { nodes: layoutedNodes, edges: layoutedEdges, groupBoxes: boxes } = layoutGraph(rawNodes, rawEdges, groups);
    const next: LaidOut = {
      signature,
      positions: new Map(layoutedNodes.map((n) => [n.id, n.position])),
      groupBoxes: boxes,
    };
    return { initialNodes: layoutedNodes, initialEdges: layoutedEdges, groupBoxes: boxes, layout: next, relaidOut: true };
  }, [flow, subDecisionCache, restApiCache, ruleSetCache, cacheVersion]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const instanceRef = useRef<ReactFlowInstance<Node<SidNodeData>, Edge> | null>(null);
  // Set once the user pans or zooms; from then on the view is theirs.
  const userMovedRef = useRef(false);

  // Another flow starts with a fitted view again.
  useEffect(() => {
    userMovedRef.current = false;
  }, [flow.id]);

  useEffect(() => {
    laidOutRef.current = layout;
    setEdges(initialEdges);
    if (!relaidOut) {
      // Same structure: patch the data of the nodes that changed and keep
      // every other node object (and its measured size) as it is.
      const next = new Map(initialNodes.map((n) => [n.id, n]));
      setNodes((current) => {
        if (current.length !== initialNodes.length || current.some((n) => !next.has(n.id))) return initialNodes;
        return current.map((n) => {
          const update = next.get(n.id)!;
          const moved = n.position.x !== update.position.x || n.position.y !== update.position.y;
          if (!moved && sameData(n.data as SidNodeData, update.data)) return n;
          return { ...n, position: update.position, data: update.data };
        });
      });
      return;
    }
    setNodes(initialNodes);
    // The graph grew (sub-decisions expanded) or changed: fit it again unless
    // the user has already moved the view. The first fit is the fitView prop;
    // a queued fitView waits until the new nodes are measured.
    if (!userMovedRef.current) void instanceRef.current?.fitView();
  }, [initialNodes, initialEdges, layout, relaidOut, setNodes, setEdges]);

  const handleInit = useCallback((instance: ReactFlowInstance<Node<SidNodeData>, Edge>) => {
    instanceRef.current = instance;
  }, []);

  // A null event is a programmatic move (fitView); only real gestures count.
  const handleMoveStart = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (event) userMovedRef.current = true;
  }, []);

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    const data = node.data as SidNodeData;
    if (data.nodeType !== 'start' && data.nodeType !== 'end') {
      onNodeClick?.(data);
    }
  }, [onNodeClick]);

  const miniMapNodeColor = useCallback((node: Node) => {
    const data = node.data as SidNodeData;
    return NODE_COLORS[data.nodeType]?.border ?? NODE_COLORS.unknown.border;
  }, []);

  return (
    <div className="flow-diagram__canvas">
      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onInit={handleInit}
        onMoveStart={handleMoveStart}
        nodeTypes={nodeTypes}
        fitView minZoom={0.1} maxZoom={2}
        onlyRenderVisibleElements={nodes.length > RENDER_VISIBLE_ONLY_ABOVE}
        nodesDraggable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Controls />
        <MiniMap nodeColor={miniMapNodeColor} />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color={CANVAS_DOT_COLOR} />
        <GroupBoxes groupBoxes={groupBoxes} />
        <Panel position="top-left">
          <div className="flow-diagram__legend">
            <CollapsibleSection title="Legend">
              <div className="flow-diagram__legend-items">
                {([
                  ['decision', 'Sub-Decision'], ['custom', 'Custom Node'],
                  ['ruleset', 'Rule Set'], ['model', 'Model'],
                  ['code_file', 'Code File'], ['condition', 'Branch'],
                  ['assignment', 'Assignment'], ['abtest', 'A/B Test'],
                  ['parallel', 'Parallel Process'], ['record_contact', 'Record Contact'],
                  ['treatment_group', 'Treatment Group'], ['segmentation_tree', 'Segmentation Tree'],
                  ['rest_api', 'REST API'],
                ] as const).map(([type, label]) => (
                  <div key={type} className="flow-diagram__legend-item">
                    <div className="flow-diagram__legend-swatch"
                      style={{ backgroundColor: NODE_COLORS[type].bg, borderColor: NODE_COLORS[type].border }} />
                    {label}
                  </div>
                ))}
                <div className="flow-diagram__legend-item">
                  <div className="flow-diagram__legend-crosslink" />
                  Cross-link
                </div>
              </div>
            </CollapsibleSection>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
