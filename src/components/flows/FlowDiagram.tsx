// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow, Controls, MiniMap, Background, BackgroundVariant, Panel,
  useNodesState, useEdgesState, type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { DecisionFlow, SidNodeData } from '../../types/sid';
import { convertFlowToGraph } from '../../flow/sidToReactFlow';
import type { RestApiDefinitionDetail } from '../../api/restApiDefinitions';
import type { RuleSetBundle } from '../../api/rulesets';
import { layoutGraph } from '../../flow/layoutGraph';
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

export default function FlowDiagram({
  flow, subDecisionCache, restApiCache, ruleSetCache, cacheVersion = 0, onNodeClick,
}: FlowDiagramProps) {
  const { initialNodes, initialEdges, groupBoxes } = useMemo(() => {
    // The caches keep their identity while they are filled in place, so the
    // page's version bump is what invalidates this memo; it is read here so
    // the dependency is a real one.
    void cacheVersion;
    const { nodes: rawNodes, edges: rawEdges, groups } = convertFlowToGraph(flow, subDecisionCache ?? new Map(), restApiCache ?? new Map(), ruleSetCache ?? new Map());
    const { nodes: layoutedNodes, edges: layoutedEdges, groupBoxes: boxes } = layoutGraph(rawNodes, rawEdges, groups);
    return { initialNodes: layoutedNodes, initialEdges: layoutedEdges, groupBoxes: boxes };
  }, [flow, subDecisionCache, restApiCache, ruleSetCache, cacheVersion]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

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
        nodeTypes={nodeTypes}
        fitView minZoom={0.1} maxZoom={2}
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
