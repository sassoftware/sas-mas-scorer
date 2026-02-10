// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'small' | 'medium' | 'large';
  shadow?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  padding = 'medium',
  shadow = true,
}) => {
  const classes = [
    'sas-card',
    `sas-card--padding-${padding}`,
    shadow ? 'sas-card--shadow' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <div className={classes}>{children}</div>;
};

interface CardHeaderProps {
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export const CardHeader: React.FC<CardHeaderProps> = ({ children, actions }) => {
  return (
    <div className="sas-card__header">
      <div className="sas-card__header-content">{children}</div>
      {actions && <div className="sas-card__header-actions">{actions}</div>}
    </div>
  );
};

interface CardBodyProps {
  children: React.ReactNode;
}

export const CardBody: React.FC<CardBodyProps> = ({ children }) => {
  return <div className="sas-card__body">{children}</div>;
};

interface CardFooterProps {
  children: React.ReactNode;
  align?: 'left' | 'center' | 'right';
}

export const CardFooter: React.FC<CardFooterProps> = ({ children, align = 'right' }) => {
  return <div className={`sas-card__footer sas-card__footer--${align}`}>{children}</div>;
};

export default Card;
