// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext, useEffect, useMemo } from 'react';
import {
  ReactFlow, ReactFlowProvider, Controls, MiniMap, Background, BackgroundVariant,
  Handle, Position, useReactFlow, MarkerType, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { pathBranchIds, type TreeIndex } from '../../utils/segTree/treeIndex';
import {
  DIAGRAM_NODE_HEIGHT,
  DIAGRAM_NODE_WIDTH,
  diagramLayout,
  type DiagramNodeKind,
} from '../../utils/segTree/treeView';
import { countInRange, type LeafPrefix } from '../../utils/segTree/leafCounts';
import type { ResultPrefixes } from './SegTreeSplitView';

interface SegTreeDiagramProps {
  index: TreeIndex;
  expanded: Set<string>;
  onToggle: (branchId: string) => void;
  focusId: string | null;
  shadowedPrefix: LeafPrefix;
  results: ResultPrefixes | null;
  onNavigate: (branchId: string | null) => void;
}

interface SegNodeData extends Record<string, unknown> {
  kind: DiagramNodeKind;
  branchId: string | null;
  splitId: string | null;
}

/** Above this many nodes the canvas gets slow; the view asks for a collapse first. */
export const DIAGRAM_NODE_LIMIT = 1500;

// The node components read the page state from context, so the node objects
// handed to React Flow only change when the layout does.
interface DiagramContext {
  index: TreeIndex;
  focusId: string | null;
  onPath: Set<string>;
  shadowedPrefix: LeafPrefix;
  results: ResultPrefixes | null;
  activate: (data: SegNodeData) => void;
}
const Ctx = createContext<DiagramContext | null>(null);

function Chips({ start, end, isLeaf }: { start: number; end: number; isLeaf: boolean }) {
  const ctx = useContext(Ctx)!;
  const shadowed = countInRange(ctx.shadowedPrefix, start, end);
  const failed = ctx.results ? countInRange(ctx.results.fail, start, end) : 0;
  const passed = ctx.results ? countInRange(ctx.results.pass, start, end) : 0;
  if (!shadowed && !failed && !passed) return null;
  return (
    <span className="segtree-dnode__chips">
      {shadowed > 0 && <span className="segtree-chip segtree-chip--warn">{isLeaf ? 'Unreachable' : `${shadowed} unreachable`}</span>}
      {failed > 0 && <span className="segtree-chip segtree-chip--fail">{isLeaf ? 'Failed' : `${failed} failed`}</span>}
      {passed > 0 && failed === 0 && <span className="segtree-chip segtree-chip--pass">{isLeaf ? 'Passed' : `${passed} passed`}</span>}
    </span>
  );
}

function SplitNode({ data }: NodeProps<Node<SegNodeData>>) {
  const ctx = useContext(Ctx)!;
  const split = ctx.index.splits.get(data.splitId!)!;
  const parent = data.branchId ? ctx.index.branches.get(data.branchId)! : null;
  const start = parent ? parent.leafStart : 0;
  const end = parent ? parent.leafEnd : ctx.index.leafIds.length;
  const collapsed = data.kind === 'collapsed';
  const paths = end - start;
  const onPath = data.branchId === null || ctx.onPath.has(data.branchId);
  return (
    <>
      {data.branchId && <Handle type="target" position={Position.Left} isConnectable={false} />}
      <button
        type="button"
        className={`segtree-dnode segtree-dnode--split${collapsed ? ' segtree-dnode--collapsed' : ''}${onPath ? ' segtree-dnode--path' : ''}${parent && parent.id === ctx.focusId ? ' segtree-dnode--focus' : ''}`}
        aria-expanded={data.branchId ? !collapsed : undefined}
        aria-label={`Split on ${split.variable}, ${paths} paths${collapsed ? ', collapsed' : ''}`}
      >
        <span className="segtree-dnode__title">{split.variable}</span>
        <span className="segtree-dnode__sub">
          {collapsed ? `+ ${paths.toLocaleString()} path${paths !== 1 ? 's' : ''} — expand` : `${paths.toLocaleString()} path${paths !== 1 ? 's' : ''}`}
          <Chips start={start} end={end} isLeaf={false} />
        </span>
      </button>
      {!collapsed && <Handle type="source" position={Position.Right} isConnectable={false} />}
    </>
  );
}

function OutcomeNode({ data }: NodeProps<Node<SegNodeData>>) {
  const ctx = useContext(Ctx)!;
  const b = ctx.index.branches.get(data.branchId!)!;
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button
        type="button"
        className={`segtree-dnode segtree-dnode--outcome${ctx.onPath.has(b.id) ? ' segtree-dnode--path' : ''}${b.id === ctx.focusId ? ' segtree-dnode--focus' : ''}`}
      >
        <span className="segtree-dnode__title">{b.outcomeName ?? '(no outcome)'}</span>
        <span className="segtree-dnode__sub">
          Path {(ctx.index.leafOrdinal.get(b.id) ?? 0) + 1}
          <Chips start={b.leafStart} end={b.leafEnd} isLeaf />
        </span>
      </button>
    </>
  );
}

const nodeTypes = { split: SplitNode, collapsed: SplitNode, outcome: OutcomeNode };

const CANVAS_DOT_COLOR = '#E5E5E5';
const EDGE_COLOR = '#767676';
const PATH_COLOR = '#0066B2';

function Canvas({ index, expanded, onToggle, focusId, shadowedPrefix, results, onNavigate }: SegTreeDiagramProps) {
  const { setCenter, getZoom } = useReactFlow();
  const layout = useMemo(() => diagramLayout(index, expanded), [index, expanded]);
  const onPath = useMemo(() => new Set(focusId ? pathBranchIds(index, focusId) : []), [index, focusId]);

  const nodes = useMemo<Node<SegNodeData>[]>(
    () => layout.nodes.map((n) => ({
      id: n.id,
      type: n.kind,
      position: { x: n.x, y: n.y },
      width: DIAGRAM_NODE_WIDTH,
      height: DIAGRAM_NODE_HEIGHT,
      data: { kind: n.kind, branchId: n.branchId, splitId: n.splitId },
      draggable: false,
      selectable: false,
    })),
    [layout]
  );

  const edges = useMemo<Edge[]>(
    () => layout.edges.map((e) => {
      const hot = onPath.has(e.branchId);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        label: e.label,
        labelStyle: { fontSize: 11, fill: hot ? PATH_COLOR : '#333333', fontWeight: hot ? 600 : 400 },
        labelBgStyle: { fill: '#FFFFFF' },
        labelBgPadding: [4, 2] as [number, number],
        style: { stroke: hot ? PATH_COLOR : EDGE_COLOR, strokeWidth: hot ? 2.5 : 1 },
        markerEnd: { type: MarkerType.ArrowClosed, color: hot ? PATH_COLOR : EDGE_COLOR },
        focusable: false,
      };
    }),
    [layout, onPath]
  );

  // The node to look at: the selected one, else the root. Fitting a large
  // tree to the canvas would shrink it past reading, so the view centres on
  // that node at a readable zoom instead and the minimap gives the overview.
  const centreOn = (animate: boolean) => {
    const b = focusId ? index.branches.get(focusId) : undefined;
    const id = b ? (b.childSplitId ? `s:${b.childSplitId}` : `o:${b.id}`) : index.rootSplitId ? `s:${index.rootSplitId}` : null;
    const n = layout.nodes.find((x) => x.id === id);
    if (!n) return;
    // With nothing selected, put the root near the left edge rather than the middle.
    const dx = b ? 0 : DIAGRAM_NODE_WIDTH * 1.5;
    setCenter(n.x + DIAGRAM_NODE_WIDTH / 2 + dx, n.y + DIAGRAM_NODE_HEIGHT / 2, {
      zoom: animate ? Math.max(getZoom(), 0.75) : 0.85,
      duration: animate ? 300 : 0,
    });
  };

  // Keep the selected node in view when the selection changes elsewhere.
  // Layout changes from expanding must not re-centre; only the selection does.
  useEffect(() => {
    if (focusId) centreOn(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const ctx: DiagramContext = {
    index,
    focusId,
    onPath,
    shadowedPrefix,
    results,
    activate: (data) => {
      // A collapsed split opens; clicking the selected open split again closes
      // it; any click selects the branch that leads to the node.
      if (data.branchId && (data.kind === 'collapsed' || (data.kind === 'split' && data.branchId === focusId))) {
        onToggle(data.branchId);
      }
      onNavigate(data.branchId);
    },
  };

  return (
    <Ctx.Provider value={ctx}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={() => centreOn(false)}
        // React Flow turns pointer events off on nodes that are neither
        // selectable nor draggable unless a node click handler is set, so the
        // click must be handled here; Enter/Space on a node's button bubbles
        // here as a click too.
        onNodeClick={(_e, node) => ctx.activate(node.data as SegNodeData)}
        minZoom={0.05}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'outcome' ? '#00897B' : '#0066B2')} />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color={CANVAS_DOT_COLOR} />
      </ReactFlow>
    </Ctx.Provider>
  );
}

export default function SegTreeDiagram(props: SegTreeDiagramProps) {
  const count = useMemo(() => diagramLayout(props.index, props.expanded).nodes.length, [props.index, props.expanded]);
  if (count > DIAGRAM_NODE_LIMIT) {
    return (
      <div className="segtree-diagram segtree-diagram--too-big" role="status">
        {count.toLocaleString()} nodes are open — too many to draw. Use <strong>Collapse all</strong> or the Outline tab, then expand the part you need.
      </div>
    );
  }
  return (
    <div className="segtree-diagram">
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
