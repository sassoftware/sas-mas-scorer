// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { SidNodeData } from '../../../types/sid';
import { NODE_COLORS } from '../../../flow/constants';

type StartEndNodeType = Node<SidNodeData, 'start' | 'end'>;

export default function StartEndNode({ data }: NodeProps<StartEndNodeType>) {
  const isStart = data.nodeType === 'start';
  // Sub-decision/parallel connector nodes have step data attached
  // and need both handles since they're intermediate nodes
  const isConnector = !!data.step;
  const isGlobalStart = isStart && !isConnector;
  const isGlobalEnd = !isStart && !isConnector;

  // Connector nodes take the sub-decision family tint so they match the
  // group box they sit inside; global Start/End stay neutral.
  const colors = isConnector ? NODE_COLORS.decision : NODE_COLORS.start;

  return (
    <>
      {(!isGlobalStart) && <Handle type="target" position={Position.Top} />}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '8px 24px',
          borderRadius: '9999px',
          border: `2px solid ${colors.border}`,
          fontSize: '14px',
          fontWeight: 500,
          backgroundColor: colors.bg,
          color: colors.text,
          minWidth: 80,
        }}
      >
        {data.label}
      </div>
      {(!isGlobalEnd) && <Handle type="source" position={Position.Bottom} />}
    </>
  );
}
