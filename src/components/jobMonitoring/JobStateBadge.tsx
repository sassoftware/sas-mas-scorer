// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Badge, BadgeVariant } from '../common/Badge';
import { ExecutionJobState } from '../../types/jobExecution';

interface JobStateBadgeProps {
  state: ExecutionJobState;
}

// Map Viya job states to badge variants. The shared StatusBadge uses British
// spelling 'cancelled' and doesn't cover 'timedOut'/'paused', so we own the
// mapping here for accuracy.
const VARIANT_BY_STATE: Record<ExecutionJobState, BadgeVariant> = {
  running: 'info',
  pending: 'info',
  paused: 'warning',
  completed: 'success',
  failed: 'error',
  canceled: 'warning',
  timedOut: 'error',
};

export const JobStateBadge: React.FC<JobStateBadgeProps> = ({ state }) => {
  const variant = VARIANT_BY_STATE[state] ?? 'default';
  const isLive = state === 'running' || state === 'pending';
  return (
    <span className={isLive ? 'job-monitoring__pulse' : undefined}>
      <Badge variant={variant} size="small">
        {state}
      </Badge>
    </span>
  );
};
