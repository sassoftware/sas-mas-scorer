// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

interface LoadingProps {
  size?: 'small' | 'medium' | 'large';
  message?: string;
  overlay?: boolean;
}

export const Loading: React.FC<LoadingProps> = ({
  size = 'medium',
  message,
  overlay = false,
}) => {
  const content = (
    <div className={`sas-loading sas-loading--${size}`}>
      <div className="sas-loading__spinner">
        <svg viewBox="0 0 50 50" className="sas-loading__svg">
          <circle
            cx="25"
            cy="25"
            r="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="80"
            strokeDashoffset="60"
          />
        </svg>
      </div>
      {message && <p className="sas-loading__message">{message}</p>}
    </div>
  );

  if (overlay) {
    return <div className="sas-loading__overlay">{content}</div>;
  }

  return content;
};

interface LoadingSkeletonProps {
  lines?: number;
  width?: string;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  lines = 3,
  width = '100%',
}) => {
  return (
    <div className="sas-skeleton" style={{ width }}>
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className="sas-skeleton__line"
          style={{
            width: index === lines - 1 ? '60%' : '100%',
          }}
        />
      ))}
    </div>
  );
};

export default Loading;
