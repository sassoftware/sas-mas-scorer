// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { SidNodeData } from '../../../types/sid';
import { NODE_COLORS, CODE_TYPE_LABELS } from '../../../flow/constants';

type CodeFileNodeType = Node<SidNodeData, 'code_file'>;

export default function CodeFileNode({ data }: NodeProps<CodeFileNodeType>) {
  const colors = NODE_COLORS.code_file;
  const codeType = data.step?.customObject?.type ?? '';
  const langLabel = CODE_TYPE_LABELS[codeType] ?? 'Code';

  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          minWidth: '160px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        }}
      >
        {/* Left bracket */}
        <div
          style={{
            width: '8px',
            borderRadius: '4px 0 0 4px',
            backgroundColor: colors.border,
          }}
        />
        <div
          style={{
            flex: 1,
            padding: '8px 16px',
            textAlign: 'center',
            backgroundColor: colors.bg,
            borderTop: `2px solid ${colors.border}`,
            borderBottom: `2px solid ${colors.border}`,
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
              {langLabel}
            </span>
          </div>
          <div style={{ fontSize: '14px', fontWeight: 500, color: colors.text }}>
            {data.label}
          </div>
        </div>
        {/* Right bracket */}
        <div
          style={{
            width: '8px',
            borderRadius: '0 4px 4px 0',
            backgroundColor: colors.border,
          }}
        />
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}
