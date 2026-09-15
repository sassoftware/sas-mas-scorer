// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { DecisionFlow, SignatureVar } from '../../types/sid';
import type { RestApiDefinitionDetail } from '../../api/restApiDefinitions';
import type { RuleSetBundle } from '../../api/rulesets';
import { formatTimestamp } from '../../utils/formatters';
import { directionLabel } from '../../utils/direction';
import { buildDecisionDeepLink } from '../../utils/deepLinks';
import { Button } from '../common';
import FlowDeepLink from './FlowDeepLink';
import FlowExportButton from './FlowExportButton';
import CollapsibleSection from './CollapsibleSection';

interface FlowHeaderProps {
  flow: DecisionFlow;
  subDecisionCache?: Map<string, DecisionFlow>;
  restApiCache?: Map<string, RestApiDefinitionDetail>;
  ruleSetCache?: Map<string, RuleSetBundle>;
  onShowWorkflowHistory?: () => void;
}

const NULL_WF_ID = 'WF00000000-0000-0000-0000-000000000000';

/**
 * The workflow states SAS Intelligent Decisioning ships, keyed by the state
 * name with case, spaces and punctuation removed. Any other state (a custom
 * workflow) keeps the neutral base chip.
 */
const WF_STATE_VARIANT: Record<string, string> = {
  developing: 'developing',
  reviewready: 'review-ready',
  approved: 'approved',
  deploymentready: 'deployment-ready',
};

function wfBadgeClass(state?: string): string {
  const key = (state ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const variant = WF_STATE_VARIANT[key];
  return variant ? `flow-wf-badge flow-wf-badge--${variant}` : 'flow-wf-badge';
}

function defaultLength(dataType?: string): number {
  const t = (dataType ?? '').toLowerCase();
  if (t === 'decimal' || t === 'integer' || t === 'number' || t === 'numeric') return 8;
  return 100;
}

/**
 * The app-wide direction mapping (components.css): input = blue,
 * output = green, in/out = neutral. A temporary variable has no direction,
 * so it takes the plain default chip; its label ("temp") is what tells it
 * apart from in/out, never the colour alone.
 */
function directionBadgeClass(direction?: string): string {
  switch (direction) {
    case 'input':  return 'sas-badge sas-badge--direction-input';
    case 'output': return 'sas-badge sas-badge--direction-output';
    case 'inOut':  return 'sas-badge sas-badge--direction-both';
    default:       return 'sas-badge sas-badge--default';
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
      <h5 className="flow-var-table__title">
        <span className={directionBadgeClass(badgeDirection)}>{directionLabel(badgeDirection)}</span>
        {title} ({vars.length})
      </h5>
      <table className="sas-table sas-table--compact flow-table--fixed">
        <thead className="sas-table__head">
          <tr>
            <th className="sas-table__th flow-var-table__col-name">Name</th>
            <th className="sas-table__th flow-var-table__col-desc">Description</th>
            <th className="sas-table__th">Direction</th>
            <th className="sas-table__th">Type</th>
            <th className="sas-table__th">Length</th>
            <th className="sas-table__th">Default</th>
          </tr>
        </thead>
        <tbody>
          {vars.map((v) => (
            <tr key={v.id} className="sas-table__row">
              <td className="sas-table__td flow-var-table__col-name" title={v.name}>{v.name}</td>
              <td className="sas-table__td flow-var-table__col-desc" title={v.description ?? ''}>{v.description ?? ''}</td>
              <td className="sas-table__td">
                <span className={directionBadgeClass(v.direction)}>
                  {directionLabel(v.direction)}
                </span>
              </td>
              <td className="sas-table__td">{v.dataType}</td>
              <td className="sas-table__td">{v.length ?? defaultLength(v.dataType)}</td>
              <td className="sas-table__td">{v.defaultValue != null ? String(v.defaultValue) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FlowHeader({
  flow, subDecisionCache, restApiCache, ruleSetCache, onShowWorkflowHistory,
}: FlowHeaderProps) {
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
          {decisionLink && <FlowDeepLink url={decisionLink.url} label={decisionLink.label} showLabel />}
          <h1 className="flow-header__title">{flow.name}</h1>
          {flow.description && <p className="flow-header__desc">{flow.description}</p>}
        </div>
        <FlowExportButton
          flow={flow}
          subDecisionCache={subDecisionCache}
          restApiCache={restApiCache}
          ruleSetCache={ruleSetCache}
        />
      </div>

      {/* Workflow status */}
      <div className="flow-header__workflow">
        {hasWorkflow ? (
          <>
            <span className={wfBadgeClass(wfState)}>
              {wfState ?? 'Active'}
            </span>
            {wfModifiedBy && (
              <span className="flow-header__workflow-meta">
                by {wfModifiedBy}{wfModifiedTs ? ` on ${formatTimestamp(wfModifiedTs)}` : ''}
              </span>
            )}
            {onShowWorkflowHistory && (
              <Button variant="secondary" size="small" onClick={onShowWorkflowHistory}>
                View History
              </Button>
            )}
          </>
        ) : (
          <span className="flow-wf-badge">No Workflow</span>
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
        <CollapsibleSection title={`Variables (${sig.length})`} defaultOpen={false}>
          <div className="flow-header__vars">
            {inputs.length > 0 && <VarTable title="Input" vars={inputs} badgeDirection="input" />}
            {outputs.length > 0 && <VarTable title="Output" vars={outputs} badgeDirection="output" />}
            {temps.length > 0 && <VarTable title="Temporary" vars={temps} badgeDirection="none" />}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
