// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { SidNodeData } from '../../../types/sid';
import { NODE_COLORS } from '../../../flow/constants';

type RuleSetNodeType = Node<SidNodeData, 'ruleset'>;

export default function RuleSetNode({ data }: NodeProps<RuleSetNodeType>) {
  const colors = NODE_COLORS.ruleset;
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div style={{ position: 'relative', minWidth: '160px' }}>
        {/* Trapezoid shape via clip-path */}
        <div
          style={{
            padding: '12px 20px',
            textAlign: 'center',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            backgroundColor: colors.bg,
            border: `2px solid ${colors.border}`,
            borderRadius: '4px',
            clipPath: 'polygon(8% 0%, 92% 0%, 100% 100%, 0% 100%)',
          }}
        >
          <div style={{ fontSize: '10px', fontWeight: 600, marginBottom: '4px' }}>
            <span
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                borderRadius: '9999px',
                color: '#ffffff',
                backgroundColor: colors.border,
              }}
            >
              Rule Set
            </span>
          </div>
          <div style={{ fontSize: '14px', fontWeight: 500, color: colors.text }}>
            {data.label}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}
