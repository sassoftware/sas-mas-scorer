// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { SidNodeData } from '../../../types/sid';
import { NODE_COLORS } from '../../../flow/constants';

type RuleSetNodeType = Node<SidNodeData, 'ruleset'>;

const pill = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '9999px',
  lineHeight: 1.4,
} as const;

/** Rule count, kind and invalid-element count arrive once the rules are fetched. */
export default function RuleSetNode({ data }: NodeProps<RuleSetNodeType>) {
  const colors = NODE_COLORS.ruleset;
  const ruleCount = typeof data.ruleCount === 'number' ? data.ruleCount : null;
  const ruleSetType = typeof data.ruleSetType === 'string' ? data.ruleSetType : '';
  const issues = typeof data.ruleIssueCount === 'number' ? data.ruleIssueCount : 0;

  const subtitle = [
    ruleCount === null ? '' : `${ruleCount} rule${ruleCount === 1 ? '' : 's'}`,
    ruleSetType,
  ]
    .filter(Boolean)
    .join(' · ');

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
          <div
            style={{
              fontSize: '10px',
              fontWeight: 600,
              marginBottom: '4px',
              display: 'flex',
              gap: '4px',
              justifyContent: 'center',
            }}
          >
            <span style={{ ...pill, color: '#ffffff', backgroundColor: colors.border }}>
              Rule Set
            </span>
            {issues > 0 && (
              <span
                style={{ ...pill, color: '#ffffff', backgroundColor: '#dc2626' }}
                title={`${issues} element${issues === 1 ? '' : 's'} reported invalid by SAS Intelligent Decisioning`}
              >
                &#9888; {issues}
              </span>
            )}
          </div>
          <div style={{ fontSize: '14px', fontWeight: 500, color: colors.text }}>
            {data.label}
          </div>
          {subtitle && (
            <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}
