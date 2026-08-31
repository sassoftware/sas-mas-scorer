// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { SidNodeData } from '../../../types/sid';
import { NODE_COLORS } from '../../../flow/constants';

type RestApiNodeType = Node<SidNodeData, 'rest_api'>;

const pill = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '9999px',
  lineHeight: 1.4,
} as const;

/** Method and host are filled in once the definition has been fetched. */
export default function RestApiNode({ data }: NodeProps<RestApiNodeType>) {
  const colors = NODE_COLORS.rest_api;
  const method = typeof data.restMethod === 'string' ? data.restMethod : '';
  const host = typeof data.restHost === 'string' ? data.restHost : '';

  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div
        style={{
          minWidth: '180px',
          padding: '10px 18px',
          textAlign: 'center',
          backgroundColor: colors.bg,
          border: `2px solid ${colors.border}`,
          borderRadius: '4px 18px 18px 4px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
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
            REST API
          </span>
          {method && (
            <span
              style={{
                ...pill,
                color: colors.border,
                backgroundColor: '#ffffff',
                border: `1px solid ${colors.border}`,
              }}
            >
              {method}
            </span>
          )}
        </div>
        <div style={{ fontSize: '14px', fontWeight: 500, color: colors.text }}>
          {data.label}
        </div>
        {host && (
          <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#6b7280', marginTop: '2px' }}>
            {host}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}
