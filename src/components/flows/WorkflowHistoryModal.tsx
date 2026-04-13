// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import type { WorkflowHistoryItem } from '../../types/sid';
import { getWorkflowHistory } from '../../api/decisions';

interface WorkflowHistoryModalProps {
  decisionId: string;
  workflowName?: string;
  onClose: () => void;
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString();
}

export default function WorkflowHistoryModal({ decisionId, onClose }: WorkflowHistoryModalProps) {
  const [items, setItems] = useState<WorkflowHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    getWorkflowHistory(decisionId)
      .then((res) => setItems(res.items ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [decisionId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="flow-code-modal__backdrop" onClick={onClose}>
      <div className="flow-wf-history__dialog" onClick={(e) => e.stopPropagation()}>
        <div className="flow-code-modal__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h3 className="flow-code-modal__title">
              Workflow History{items.length > 0 ? `: ${items[0].workflowName}` : ''}
            </h3>
          </div>
          <button onClick={onClose} className="flow-code-modal__close-btn">&times;</button>
        </div>
        <div className="flow-wf-history__body">
          {loading && <div style={{ color: '#9ca3af', fontSize: '14px' }}>Loading workflow history...</div>}
          {error && <div style={{ color: '#f87171', fontSize: '14px' }}>Error: {error}</div>}
          {!loading && !error && items.length === 0 && (
            <div style={{ color: '#9ca3af', fontSize: '14px' }}>No workflow history available.</div>
          )}
          {!loading && !error && items.length > 0 && (
            <div className="flow-wf-history__timeline">
              {items.map((item, i) => (
                <div key={i} className="flow-wf-history__entry">
                  <div className="flow-wf-history__dot" />
                  <div className="flow-wf-history__content">
                    <div className="flow-wf-history__transition">
                      <span className="flow-wf-history__state">{item.statusChangedFrom}</span>
                      <span className="flow-wf-history__arrow">&rarr;</span>
                      <span className="flow-wf-history__state">{item.statusChangedTo}</span>
                    </div>
                    <div className="flow-wf-history__meta">
                      {item.modifiedBy} &middot; {formatTs(item.modifiedTimeStamp)}
                      {item.version && <> &middot; v{item.version}</>}
                    </div>
                    {item.comments && (
                      <div className="flow-wf-history__comment">{item.comments}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
