// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import type { WorkflowHistoryItem } from '../../types/sid';
import { getWorkflowHistory } from '../../api/decisions';
import { Alert, EmptyState, Loading, Modal } from '../common';

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

  const title = `Workflow History${items.length > 0 ? `: ${items[0].workflowName}` : ''}`;

  return (
    <Modal title={title} onClose={onClose} size="medium">
      {loading && <Loading size="small" message="Loading workflow history..." />}
      {error && <Alert variant="error">Could not load the workflow history: {error}</Alert>}
      {!loading && !error && items.length === 0 && (
        <EmptyState title="No workflow history available." />
      )}
      {!loading && !error && items.length > 0 && (
        <ol className="flow-wf-history__timeline">
          {items.map((item, i) => (
            <li key={i} className="flow-wf-history__entry">
              <div className="flow-wf-history__dot" aria-hidden="true" />
              <div className="flow-wf-history__content">
                <div className="flow-wf-history__transition">
                  <span className="flow-wf-history__state">{item.statusChangedFrom}</span>
                  <span className="flow-wf-history__arrow" aria-hidden="true">&rarr;</span>
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
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
