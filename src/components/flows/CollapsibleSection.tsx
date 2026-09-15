// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, type ReactNode } from 'react';

interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

/**
 * The one disclosure affordance of the flows feature: a heading that is a
 * real button (`aria-expanded`), used by the side panel sections, the diagram
 * legend and the header's variable tables. Children are mounted only while
 * open, so expensive content (a serialized step) is built on demand.
 */
export default function CollapsibleSection({ title, children, defaultOpen = true }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flow-section">
      <h4 className="flow-section__heading">
        <button
          type="button"
          className="flow-section__toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="flow-section__arrow" aria-hidden="true">{open ? '▾' : '▸'}</span>
          {title}
        </button>
      </h4>
      {open && <div className="flow-section__body">{children}</div>}
    </div>
  );
}
