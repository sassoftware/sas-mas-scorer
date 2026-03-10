// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

interface Props {
  value: unknown;
}

export const ReadonlyWidget: React.FC<Props> = ({ value }) => {
  if (value === null || value === undefined) {
    return <span className="ui-runner__readonly ui-runner__readonly--null">--</span>;
  }

  if (Array.isArray(value)) {
    return <span className="ui-runner__readonly">[{value.join(', ')}]</span>;
  }

  if (typeof value === 'object') {
    return <pre className="ui-runner__readonly ui-runner__readonly--json">{JSON.stringify(value, null, 2)}</pre>;
  }

  return <span className="ui-runner__readonly">{String(value)}</span>;
};
