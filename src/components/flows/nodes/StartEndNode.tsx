// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { SidNodeData } from '../../../types/sid';

type StartEndNodeType = Node<SidNodeData, 'start' | 'end'>;

export default function StartEndNode({ data }: NodeProps<StartEndNodeType>) {
  const isStart = data.nodeType === 'start';
  // Sub-decision/parallel connector nodes have step data attached
  // and need both handles since they're intermediate nodes
  const isConnector = !!data.step;
  const isGlobalStart = isStart && !isConnector;
  const isGlobalEnd = !isStart && !isConnector;

  // Connector nodes get a subtle tint to distinguish them from global Start/End
  const borderColor = isConnector ? '#E06050' : '#999999';
  const bgColor = isConnector ? '#FEF2F2' : '#ffffff';

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
          border: `2px solid ${borderColor}`,
          fontSize: '14px',
          fontWeight: 500,
          backgroundColor: bgColor,
          color: '#333333',
          minWidth: 80,
        }}
      >
        {data.label}
      </div>
      {(!isGlobalEnd) && <Handle type="source" position={Position.Bottom} />}
    </>
  );
}
