// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { SidNodeData } from '../../../types/sid';
import { NODE_COLORS, CODE_TYPE_LABELS, NODE_TYPE_LABELS } from '../../../flow/constants';

type DecisionNodeType = Node<SidNodeData, 'decision'>;

export default function DecisionNode({ data }: NodeProps<DecisionNodeType>) {
  const colors = NODE_COLORS[data.nodeType];
  const codeType = data.step?.customObject?.type;
  let badge: string;
  if (codeType && CODE_TYPE_LABELS[codeType]) {
    badge = CODE_TYPE_LABELS[codeType];
  } else if (data.nodeType === 'custom') {
    // Show the actual custom object type name (e.g., "Call LLM" via the node name, type via customObject.type)
    badge = codeType ?? 'Custom';
  } else if (data.nodeType === 'decision') {
    badge = 'Decision';
  } else if (data.nodeType === 'unknown') {
    badge = 'Unknown';
  } else {
    badge = NODE_TYPE_LABELS[data.nodeType] ?? data.nodeType;
  }

  const badgeColor = colors.border;

  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div
        style={{
          borderRadius: '8px',
          border: `2px solid ${colors.border}`,
          padding: '8px 16px',
          minWidth: '160px',
          textAlign: 'center',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          backgroundColor: colors.bg,
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: '9999px',
              color: '#ffffff',
              fontSize: '10px',
              backgroundColor: badgeColor,
            }}
          >
            {badge}
          </span>
        </div>
        <div style={{ fontSize: '14px', fontWeight: 500, color: colors.text }}>
          {data.label}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}
