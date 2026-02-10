// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'small' | 'medium';
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'medium',
}) => {
  return (
    <span className={`sas-badge sas-badge--${variant} sas-badge--${size}`}>
      {children}
    </span>
  );
};

export const TypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const getVariant = (): BadgeVariant => {
    if (type.includes('Array')) return 'info';
    if (type === 'string') return 'success';
    if (type === 'decimal' || type === 'integer' || type === 'bigint') return 'warning';
    return 'default';
  };

  return (
    <Badge variant={getVariant()} size="small">
      {type}
    </Badge>
  );
};

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const getVariant = (): BadgeVariant => {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'public':
        return 'success';
      case 'running':
      case 'pending':
      case 'submitted':
        return 'info';
      case 'failed':
      case 'error':
      case 'timedout':
        return 'error';
      case 'private':
      case 'cancelled':
        return 'warning';
      default:
        return 'default';
    }
  };

  return <Badge variant={getVariant()}>{status}</Badge>;
};

export default Badge;
