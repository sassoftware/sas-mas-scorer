// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { DecisionFlow, SignatureVar } from '../../types/sid';
import { formatTimestamp } from '../../utils/formatters';
import { directionLabel, directionBadgeVariant } from '../../utils/direction';
import { buildDecisionDeepLink } from '../../utils/deepLinks';
import FlowDeepLink from './FlowDeepLink';
import FlowExportButton from './FlowExportButton';

interface FlowHeaderProps {
  flow: DecisionFlow;
  subDecisionCache?: Map<string, DecisionFlow>;
  onShowWorkflowHistory?: () => void;
}

const NULL_WF_ID = 'WF00000000-0000-0000-0000-000000000000';

function defaultLength(dataType?: string): number {
  const t = (dataType ?? '').toLowerCase();
  if (t === 'decimal' || t === 'integer' || t === 'number' || t === 'numeric') return 8;
  return 100;
}

/** Map direction → BEM modifier class */
function directionBadgeClass(direction?: string): string {
  const variant = directionBadgeVariant(direction);
  switch (variant) {
    case 'success': return 'flow-dir-badge flow-dir-badge--input';
    case 'info':    return 'flow-dir-badge flow-dir-badge--output';
    case 'warning': return 'flow-dir-badge flow-dir-badge--inout';
    default:        return 'flow-dir-badge flow-dir-badge--temp';
  }
}

function MetaItem({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <span className="flow-header__meta-item">
      <span className="flow-header__meta-label">{label}:</span>{' '}
      <span className={mono ? 'flow-header__meta-mono' : undefined}>{value}</span>
    </span>
  );
}

function VarTable({ title, vars, badgeDirection }: { title: string; vars: SignatureVar[]; badgeDirection: string }) {
  return (
    <div className="flow-var-table">
      <h4 className="flow-var-table__title">
        <span className={directionBadgeClass(badgeDirection)}>{directionLabel(badgeDirection)}</span>
        {' '}{title} ({vars.length})
      </h4>
      <table className="flow-var-table__table">
        <thead>
          <tr>
            <th className="flow-var-table__col-name">Name</th>
            <th className="flow-var-table__col-desc">Description</th>
            <th>Direction</th>
            <th>Type</th>
            <th>Length</th>
            <th>Default</th>
          </tr>
        </thead>
        <tbody>
          {vars.map((v) => (
            <tr key={v.id}>
              <td className="flow-var-table__col-name" title={v.name}>{v.name}</td>
              <td className="flow-var-table__col-desc" title={v.description ?? ''}>{v.description ?? ''}</td>
              <td>
                <span className={directionBadgeClass(v.direction)}>
                  {directionLabel(v.direction)}
                </span>
              </td>
              <td>{v.dataType}</td>
              <td>{v.length ?? defaultLength(v.dataType)}</td>
              <td>{v.defaultValue != null ? String(v.defaultValue) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FlowHeader({ flow, subDecisionCache, onShowWorkflowHistory }: FlowHeaderProps) {
  const sig = flow.signature ?? [];
  const inputs = sig.filter((v) => v.direction === 'input' || v.direction === 'inOut');
  const outputs = sig.filter((v) => v.direction === 'output' || v.direction === 'inOut');
  const temps = sig.filter((v) => v.direction === 'none');
  const decisionLink = buildDecisionDeepLink(flow.id);

  const wfId = flow.workflowDefinitionId ?? (flow.properties?.workflowDefinitionId as string | undefined);
  const hasWorkflow = !!wfId && wfId !== NULL_WF_ID;
  const wfState = hasWorkflow ? (flow.properties?.workflowState as string | undefined) : undefined;
  const wfModifiedBy = hasWorkflow ? (flow.properties?.workflowModifiedBy as string | undefined) : undefined;
  const wfModifiedTs = hasWorkflow ? (flow.properties?.workflowModifiedTimeStamp as string | undefined) : undefined;

  return (
    <div className="flow-header__card">
      <div className="flow-header__top">
        <div>
          {decisionLink && <FlowDeepLink url={decisionLink.url} label={decisionLink.label} />}
          <h1 className="flow-header__title">{flow.name}</h1>
          {flow.description && <p className="flow-header__desc">{flow.description}</p>}
        </div>
        <FlowExportButton flow={flow} subDecisionCache={subDecisionCache} />
      </div>

      {/* Workflow status */}
      <div className="flow-header__workflow">
        {hasWorkflow ? (
          <>
            <span className={`flow-wf-badge flow-wf-badge--${(wfState ?? '').toLowerCase().replace(/\s+/g, '-')}`}>
              {wfState ?? 'Active'}
            </span>
            {wfModifiedBy && (
              <span className="flow-header__workflow-meta">
                by {wfModifiedBy}{wfModifiedTs ? ` on ${formatTimestamp(wfModifiedTs)}` : ''}
              </span>
            )}
            {onShowWorkflowHistory && (
              <button className="flow-wf-history-btn" onClick={onShowWorkflowHistory}>
                View History
              </button>
            )}
          </>
        ) : (
          <span className="flow-wf-badge flow-wf-badge--none">No Workflow</span>
        )}
      </div>

      <div className="flow-header__meta">
        <MetaItem label="ID" value={flow.id} mono />
        <MetaItem label="Version" value={`${flow.majorRevision}.${flow.minorRevision}`} />
        <MetaItem label="Created" value={formatTimestamp(flow.creationTimeStamp)} />
        <MetaItem label="Modified" value={formatTimestamp(flow.modifiedTimeStamp)} />
        <MetaItem label="Created by" value={flow.createdBy} />
        <MetaItem label="Modified by" value={flow.modifiedBy} />
        <MetaItem label="Nodes" value={String(flow.nodeCount ?? '?')} />
        {flow.validationStatus && <MetaItem label="Validation" value={flow.validationStatus} />}
      </div>
      {(flow.hasErrors || flow.hasWarnings) && (
        <div className="flow-header__badges">
          {flow.hasErrors && <span className="flow-header__badge--error">Has Errors</span>}
          {flow.hasWarnings && <span className="flow-header__badge--warning">Has Warnings</span>}
        </div>
      )}
      {sig.length > 0 && (
        <details className="flow-header__vars-toggle">
          <summary>Variables ({sig.length})</summary>
          <div style={{ marginTop: '8px' }}>
            {inputs.length > 0 && <VarTable title="Input" vars={inputs} badgeDirection="input" />}
            {outputs.length > 0 && <VarTable title="Output" vars={outputs} badgeDirection="output" />}
            {temps.length > 0 && <VarTable title="Temporary" vars={temps} badgeDirection="none" />}
          </div>
        </details>
      )}
    </div>
  );
}
