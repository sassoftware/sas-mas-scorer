// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { SidNodeData } from '../../../types/sid';
import { NODE_COLORS } from '../../../flow/constants';
import { truncate } from '../../../utils/formatters';

type ConditionNodeType = Node<SidNodeData, 'condition'>;

export default function ConditionNode({ data }: NodeProps<ConditionNodeType>) {
  const colors = NODE_COLORS[data.nodeType] ?? NODE_COLORS.condition;
  const expression = data.expression ?? '';

  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 200,
          height: 100,
        }}
      >
        {/* Diamond shape via SVG */}
        <svg
          width="200"
          height="100"
          viewBox="0 0 200 100"
          style={{
            position: 'absolute',
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.08))',
          }}
        >
          <polygon
            points="100,2 198,50 100,98 2,50"
            fill={colors.bg}
            stroke={colors.border}
            strokeWidth="2"
          />
        </svg>
        <div
          style={{
            position: 'relative',
            zIndex: 10,
            textAlign: 'center',
            padding: '0 24px',
            maxWidth: '150px',
          }}
        >
          {data.nodeType === 'abtest' && (
            <div
              style={{
                fontSize: '9px',
                fontWeight: 600,
                marginBottom: '2px',
                color: colors.border,
              }}
            >
              A/B Test
            </div>
          )}
          <div style={{ fontSize: '12px', fontWeight: 600, color: colors.text }}>
            {data.label}
          </div>
          {expression && expression !== data.label && (
            <div
              style={{
                fontSize: '9px',
                marginTop: '2px',
                opacity: 0.7,
                color: colors.text,
              }}
            >
              {truncate(expression, 35)}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}
