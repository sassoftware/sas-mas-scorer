// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import {
  ReactFlow, Controls, MiniMap, Background, BackgroundVariant, Panel,
  useNodesState, useEdgesState, type Edge, type Node, type NodeChange, type ReactFlowInstance, type XYPosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { DecisionFlow, SidNodeData } from '../../types/sid';
import { convertFlowToGraph, type NodeGroup } from '../../flow/sidToReactFlow';
import type { RestApiDefinitionDetail } from '../../api/restApiDefinitions';
import type { RuleSetBundle } from '../../api/rulesets';
import type { TraceRole } from '../../flow/variableUsage';
import { layoutGraph, type GroupBox } from '../../flow/layoutGraph';
import { NODE_COLORS, NODE_DIMENSIONS } from '../../flow/constants';
import StartEndNode from './nodes/StartEndNode';
import DecisionNode from './nodes/DecisionNode';
import RuleSetNode from './nodes/RuleSetNode';
import ModelNode from './nodes/ModelNode';
import CodeFileNode from './nodes/CodeFileNode';
import RestApiNode from './nodes/RestApiNode';
import ConditionNode from './nodes/ConditionNode';
import { FlowTraceContext } from './nodes/NodeFrame';
import GroupBoxes from './GroupBoxes';
import CollapsibleSection from './CollapsibleSection';
import FlowNodeFinder, { finderEntries, type FinderEntry } from './FlowNodeFinder';

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

/** How a node was chosen; decides how the view moves to it. */
export type SelectVia = 'pointer' | 'keyboard' | 'find' | 'jump';

/**
 * A request to bring a node into view. `fit` zooms to it (Find node, a trace
 * jump); `center` centres it at the current zoom (the panel just opened);
 * `reveal` pans only if it is not fully in view.
 */
export interface FocusRequest {
  id: string;
  mode: 'fit' | 'center' | 'reveal';
  /** A new number for every request, so the same node can be asked for twice. */
  seq: number;
}

/** What the diagram drew, for the page's variable index and jump lists. */
export interface DiagramGraph {
  nodes: Node<SidNodeData>[];
  groups: NodeGroup[];
}

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
  /** References (sub-decision URIs, rule set ids, REST URIs) that failed to load. */
  unavailableRefs?: ReadonlySet<string>;
  /** The node whose details are open; the diagram's selection follows it. */
  selectedId?: string | null;
  focusRequest?: FocusRequest | null;
  /** Each node's part in the traced variable, or null when nothing is traced. */
  traceRoles?: ReadonlyMap<string, TraceRole> | null;
  /** Shown in the toolbar next to Find node (the trace summary). */
  toolbarExtra?: ReactNode;
  onNodeSelect?: (nodeData: SidNodeData, nodeId: string, via: SelectVia) => void;
  onGraphChange?: (graph: DiagramGraph) => void;
}

/** Canvas dot grid and the mini-map fallback are SVG fills, so they take literal colours (--sas-gray-200 / NODE_COLORS.unknown.border). */
const CANVAS_DOT_COLOR = '#E5E5E5';

/** Above this many nodes only the ones in view are rendered. */
const RENDER_VISIBLE_ONLY_ABOVE = 100;

/** The side panel slides the page margin in over --transition-normal (250ms); move the view after it. */
const PANEL_SETTLE_MS = 280;

/** The zoom Find node and trace jumps show a node at. */
const FIT_ZOOM = 1;

const EMPTY_REFS: ReadonlySet<string> = new Set();

/** React Flow's keyboard hint, reworded for what Enter and Space do here. */
const ARIA_LABELS = {
  'node.a11yDescription.default': 'Press Enter or Space to open the node details.',
  'node.a11yDescription.keyboardDisabled': 'Press Enter or Space to open the node details.',
};

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

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export default function FlowDiagram({
  flow, subDecisionCache, restApiCache, ruleSetCache, cacheVersion = 0, unavailableRefs = EMPTY_REFS,
  selectedId = null, focusRequest = null, traceRoles = null, toolbarExtra, onNodeSelect, onGraphChange,
}: FlowDiagramProps) {
  // The layout on screen. dagre runs only when the structure changes
  // (sub-decisions expanded, another flow); badge updates reuse its positions.
  const laidOutRef = useRef<LaidOut | null>(null);

  const { initialNodes, initialEdges, groups, groupBoxes, layout, relaidOut } = useMemo(() => {
    // The caches keep their identity while they are filled in place, so the
    // page's version bump is what invalidates this memo; it is read here so
    // the dependency is a real one.
    void cacheVersion;
    const { nodes: rawNodes, edges: rawEdges, groups: rawGroups } = convertFlowToGraph(
      flow, subDecisionCache ?? new Map(), restApiCache ?? new Map(), ruleSetCache ?? new Map(), unavailableRefs,
    );
    const signature = structureSignature(rawNodes, rawEdges, rawGroups);
    const previous = laidOutRef.current;
    if (previous && previous.signature === signature) {
      const placed = rawNodes.map((n) => ({ ...n, position: previous.positions.get(n.id) ?? n.position }));
      return {
        initialNodes: placed, initialEdges: rawEdges, groups: rawGroups,
        groupBoxes: previous.groupBoxes, layout: previous, relaidOut: false,
      };
    }
    const { nodes: layoutedNodes, edges: layoutedEdges, groupBoxes: boxes } = layoutGraph(rawNodes, rawEdges, rawGroups);
    const next: LaidOut = {
      signature,
      positions: new Map(layoutedNodes.map((n) => [n.id, n.position])),
      groupBoxes: boxes,
    };
    return {
      initialNodes: layoutedNodes, initialEdges: layoutedEdges, groups: rawGroups,
      groupBoxes: boxes, layout: next, relaidOut: true,
    };
  }, [flow, subDecisionCache, restApiCache, ruleSetCache, cacheVersion, unavailableRefs]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const instanceRef = useRef<ReactFlowInstance<Node<SidNodeData>, Edge> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  // Set once the user pans or zooms; from then on the view is theirs.
  const userMovedRef = useRef(false);
  // Read by the node effect below, which must not re-run on a selection change.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // Another flow starts with a fitted view again.
  useEffect(() => {
    userMovedRef.current = false;
  }, [flow.id]);

  useEffect(() => {
    onGraphChange?.({ nodes: initialNodes, groups });
  }, [initialNodes, groups, onGraphChange]);

  useEffect(() => {
    laidOutRef.current = layout;
    setEdges(initialEdges);
    const withSelection = (n: Node<SidNodeData>) => {
      const selected = n.id === selectedIdRef.current;
      return !!n.selected === selected ? n : { ...n, selected };
    };
    if (!relaidOut) {
      // Same structure: patch the data of the nodes that changed and keep
      // every other node object (and its measured size) as it is.
      const next = new Map(initialNodes.map((n) => [n.id, n]));
      setNodes((current) => {
        if (current.length !== initialNodes.length || current.some((n) => !next.has(n.id))) {
          return initialNodes.map(withSelection);
        }
        return current.map((n) => {
          const update = next.get(n.id)!;
          const moved = n.position.x !== update.position.x || n.position.y !== update.position.y;
          if (!moved && sameData(n.data as SidNodeData, update.data)) return n;
          return { ...n, position: update.position, data: update.data };
        });
      });
      return;
    }
    setNodes(initialNodes.map(withSelection));
    // The graph grew (sub-decisions expanded) or changed: fit it again unless
    // the user has already moved the view. The first fit is the fitView prop;
    // a queued fitView waits until the new nodes are measured.
    if (!userMovedRef.current) void instanceRef.current?.fitView();
  }, [initialNodes, initialEdges, layout, relaidOut, setNodes, setEdges]);

  // The selection is the page's (React Flow's own is reset whenever the nodes
  // are replaced): only the nodes whose flag changes get a new object.
  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const next = current.map((n) => {
        const selected = n.id === selectedId;
        if (!!n.selected === selected) return n;
        changed = true;
        return { ...n, selected };
      });
      return changed ? next : current;
    });
  }, [selectedId, setNodes]);

  // React Flow would select and deselect on its own (pane clicks, Escape on a
  // node); the page decides, so those changes are dropped.
  const handleNodesChange = useCallback((changes: NodeChange<Node<SidNodeData>>[]) => {
    const kept = changes.filter((c) => c.type !== 'select');
    if (kept.length > 0) onNodesChange(kept);
  }, [onNodesChange]);

  // Bring a node into view once the side panel has finished sliding in.
  useEffect(() => {
    if (!focusRequest) return;
    const timer = window.setTimeout(() => {
      const instance = instanceRef.current;
      const node = instance?.getInternalNode(focusRequest.id);
      if (!instance || !node) return;
      const duration = prefersReducedMotion() ? 0 : 300;
      // A node outside the view of a large diagram may not have been drawn
      // (and measured) yet; its layout size is the same.
      const fallback = NODE_DIMENSIONS[(node.data as SidNodeData).nodeType] ?? NODE_DIMENSIONS.unknown;
      const width = node.measured.width ?? fallback.width;
      const height = node.measured.height ?? fallback.height;
      const { x, y } = node.internals.positionAbsolute;
      if (focusRequest.mode === 'reveal') {
        const rect = canvasRef.current?.getBoundingClientRect();
        const topLeft = instance.flowToScreenPosition({ x, y });
        const bottomRight = instance.flowToScreenPosition({ x: x + width, y: y + height });
        const inView = !!rect && topLeft.x >= rect.left && topLeft.y >= rect.top
          && bottomRight.x <= rect.right && bottomRight.y <= rect.bottom;
        if (inView) return;
      }
      userMovedRef.current = true;
      // Fit: centre it at a readable zoom (fitView skips nodes that have not
      // been measured, which a large diagram's off-screen nodes are not).
      const zoom = focusRequest.mode === 'fit' ? FIT_ZOOM : instance.getZoom();
      void instance.setCenter(x + width / 2, y + height / 2, { zoom, duration });
    }, PANEL_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [focusRequest]);

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
      onNodeSelect?.(data, node.id, 'pointer');
    }
  }, [onNodeSelect]);

  // Enter or Space on a focused node opens it, as a click does. React Flow's
  // own handler only selects, and the page owns the selection.
  const handleCanvasKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target as HTMLElement;
    if (!target.classList.contains('react-flow__node')) return;
    const id = target.getAttribute('data-id');
    const node = id ? instanceRef.current?.getNode(id) : undefined;
    if (!node || !id) return;
    event.preventDefault();
    const data = node.data as SidNodeData;
    if (data.nodeType !== 'start' && data.nodeType !== 'end') onNodeSelect?.(data, id, 'keyboard');
  }, [onNodeSelect]);

  const entries = useMemo(() => finderEntries(initialNodes, groups), [initialNodes, groups]);
  const handleFind = useCallback((entry: FinderEntry) => {
    onNodeSelect?.(entry.data, entry.id, 'find');
  }, [onNodeSelect]);

  const miniMapNodeColor = useCallback((node: Node) => {
    const data = node.data as SidNodeData;
    return NODE_COLORS[data.nodeType]?.border ?? NODE_COLORS.unknown.border;
  }, []);

  return (
    <div className="flow-diagram">
      <div className="flow-diagram__toolbar">
        <FlowNodeFinder entries={entries} onPick={handleFind} />
        {toolbarExtra}
      </div>
      <div
        ref={canvasRef}
        className={`flow-diagram__canvas${traceRoles ? ' flow-diagram__canvas--tracing' : ''}`}
        onKeyDown={handleCanvasKeyDown}
      >
        <FlowTraceContext.Provider value={traceRoles}>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={handleNodesChange} onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            onInit={handleInit}
            onMoveStart={handleMoveStart}
            nodeTypes={nodeTypes}
            fitView minZoom={0.1} maxZoom={2}
            onlyRenderVisibleElements={nodes.length > RENDER_VISIBLE_ONLY_ABOVE}
            nodesDraggable={false}
            nodesConnectable={false}
            deleteKeyCode={null}
            ariaLabelConfig={ARIA_LABELS}
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
        </FlowTraceContext.Provider>
      </div>
    </div>
  );
}
