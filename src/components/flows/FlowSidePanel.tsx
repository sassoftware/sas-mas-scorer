// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect } from 'react';
import type { SidNodeData, Step, StepMapping, VariableAssignment } from '../../types/sid';
import { NODE_COLORS, NODE_TYPE_LABELS, CODE_TYPE_LABELS } from '../../flow/constants';
import { ruleSetViewOf } from '../../flow/ruleSetViewCache';
import { buildConditionExpression } from '../../utils/classify';
import { directionLabel } from '../../utils/direction';
import { buildDeepLink, buildRuleSetDeepLink, buildModelDeepLink, buildCustomObjectDeepLink } from '../../utils/deepLinks';
import { getSasViyaUrl } from '../../config';
import { getRuleSetBundle, getRuleSet, type RuleSetDetail, type RuleSetBundle } from '../../api/rulesets';
import type { RuleElementView } from '../../utils/ruleSetView';
import { getSidModel, type SidModelDetail } from '../../api/sidModels';
import { getCodeFileDetail, type CodeFileDetail } from '../../api/codeFiles';
import { getTreatmentDefinitionByRevision, getTreatmentGroupByUri, type TreatmentDefinitionDetail, type TreatmentGroupDetail } from '../../api/treatments';
import { getDecisionNodeType, type DecisionNodeTypeDetail } from '../../api/nodeTypes';
import { getSegmentationTree, type SegmentationTreeDetail, type SegTreeNode } from '../../api/segmentationTrees';
import {
  authTypeLabel, boundDecisionVariable, getRestApiDefinitionByUri,
  REST_API_DEFINITION_TYPE, type RestApiDefinitionDetail, type RestApiParam,
} from '../../api/restApiDefinitions';
import { Alert, Button, Loading } from '../common';
import FlowDeepLink from './FlowDeepLink';
import CollapsibleSection from './CollapsibleSection';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function extractIdFromUri(uri: string): string {
  const parts = uri.split('/');
  return parts[parts.length - 1] ?? uri;
}

/** Map a SAS API URI to a deep-linkable asset type.
 *  Patterns use UUID boundary to avoid matching sub-resource paths
 *  (e.g. /decisions/flows/{id}/revisions/… should NOT match as a decision).
 *  Custom object step links are not deep-linkable. */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const URI_ASSET_MAP: [RegExp, string][] = [
  [new RegExp(`/decisions/flows/${UUID}$`), 'decision'],
  [new RegExp(`/decisions/codeFiles/${UUID}`), 'codeFile'],
  [new RegExp(`/decisions/ruleSets/${UUID}`), 'ruleset'],
  [new RegExp(`/decisions/treatmentGroups/${UUID}`), 'treatmentGroup'],
  [new RegExp(`/decisions/treatments/${UUID}`), 'treatment'],
  [new RegExp(`/decisions/segmentationTrees/${UUID}`), 'segmentationTree'],
  [new RegExp(`/modelRepository/models/${UUID}`), 'model'],
];

function buildDeepLinkFromUri(uri: string) {
  for (const [re, assetType] of URI_ASSET_MAP) {
    if (re.test(uri)) return buildDeepLink(assetType, uri);
  }
  return null;
}

function isTreatmentGroup(type?: string): boolean {
  return type === 'treatmentGroup';
}

function displayLength(length?: number, dataType?: string): string {
  if (length !== undefined && length !== null) return String(length);
  const t = (dataType ?? '').toLowerCase();
  if (t === 'decimal' || t === 'integer' || t === 'number' || t === 'numeric') return '8';
  return '100';
}

function directionBadgeClass(direction?: string): string {
  switch (direction) {
    case 'input': return 'flow-dir-badge flow-dir-badge--input';
    case 'output': return 'flow-dir-badge flow-dir-badge--output';
    case 'inOut': return 'flow-dir-badge flow-dir-badge--inout';
    default: return 'flow-dir-badge flow-dir-badge--temp';
  }
}

/* ------------------------------------------------------------------ */
/*  Internal sub-components                                            */
/* ------------------------------------------------------------------ */

/**
 * Serialises the step only when its section is expanded — a branch step
 * carries its whole onTrue/onFalse subtree, so this is not free.
 */
function RawStepJson({ step }: { step: Step }) {
  return <pre className="flow-sp-code">{JSON.stringify(step, null, 2)}</pre>;
}

function VariableTable({ variables }: { variables: { name: string; direction?: string; dataType?: string; length?: number; description?: string }[] }) {
  if (!variables.length) return null;
  return (
    <table className="flow-sp-table flow-sp-table--fixed">
      <thead>
        <tr>
          <th>Name</th>
          <th>Direction</th>
          <th>Type</th>
          <th>Length</th>
        </tr>
      </thead>
      <tbody>
        {variables.map((v, i) => (
          <tr key={i} title={v.description || undefined}>
            <td>{v.name}</td>
            <td>
              <span className={directionBadgeClass(v.direction)}>
                {directionLabel(v.direction)}
              </span>
            </td>
            <td>{v.dataType ?? ''}</td>
            <td>{displayLength(v.length, v.dataType)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Renders a template string with its {placeholders} highlighted. */
function TemplateText({ text }: { text: string }) {
  if (!text) return <>&mdash;</>;
  const parts = text.split(/(\{[^{}\s]+\})/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\{[^{}\s]+\}$/.test(part)
          ? <span key={i} className="flow-sp-ph">{part}</span>
          : <span key={i}>{part}</span>,
      )}
    </>
  );
}

/** Query parameters / headers, with the decision variable each placeholder binds to. */
function ParamTable({ params, mappings }: { params: RestApiParam[]; mappings?: StepMapping[] }) {
  if (!params.length) return null;
  return (
    <table className="flow-sp-table flow-sp-table--fixed">
      <thead>
        <tr>
          <th>Key</th>
          <th>Value</th>
          <th>Decision variable</th>
        </tr>
      </thead>
      <tbody>
        {params.map((p, i) => {
          const bound = boundDecisionVariable(p.value, mappings);
          return (
            <tr key={i} title={p.description || undefined}>
              <td>{p.key}</td>
              <td><TemplateText text={p.value ?? ''} /></td>
              <td>{bound ?? '\u2014'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** One condition or action, with its kind and any lookup table or list it reads. */
function RuleElement({ element, lead }: { element: RuleElementView; lead: string }) {
  return (
    <div className={`flow-sp-rule__line${element.invalid ? ' flow-sp-rule__line--invalid' : ''}`}>
      <span className="flow-sp-rule__lead">{lead}</span>
      <span className="flow-sp-rule__expr">{element.text || '—'}</span>
      <span className="flow-sp-rule__kind">{element.kind}</span>
      {element.reference && (
        <span className="flow-sp-rule__ref" title={element.reference.id}>
          {element.reference.kind === 'list' ? 'list' : 'lookup'} {element.reference.name}
        </span>
      )}
      {element.invalid && element.message && (
        <span className="flow-sp-rule__msg">{element.message}</span>
      )}
    </div>
  );
}

/**
 * A rule set is an ordered if / else if / else chain. Rules arrive in execution
 * order and conditions within a rule are ANDed.
 */
function RuleChain({ bundle }: { bundle: RuleSetBundle }) {
  const view = ruleSetViewOf(bundle);

  return (
    <>
      {view.invalidCount > 0 && (
        <div className="flow-sp-rule-alert">
          <Alert
            variant="error"
            title={`${view.invalidCount} element${view.invalidCount === 1 ? '' : 's'} reported invalid`}
          >
            {view.issues.map((issue, i) => (
              <div key={i} className="flow-sp-rule-alert__item">
                {issue.message}
                <span className="flow-sp-rule-alert__rules">
                  {issue.rules.join(', ')}
                </span>
              </div>
            ))}
          </Alert>
        </div>
      )}

      {(view.reads.length > 0 || view.writes.length > 0) && (
        <>
          <h5 className="flow-side-panel__section-title">Term usage</h5>
          {view.reads.length > 0 && (
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Reads:</span>
              <span className="flow-sp-detail__value">{view.reads.join(', ')}</span>
            </div>
          )}
          {view.writes.length > 0 && (
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Writes:</span>
              <span className="flow-sp-detail__value">{view.writes.join(', ')}</span>
            </div>
          )}
        </>
      )}

      {view.references.length > 0 && (
        <>
          <h5 className="flow-side-panel__section-title">Lookup tables &amp; lists</h5>
          {view.references.map((ref, i) => (
            <div key={i} className="flow-sp-detail">
              <span className="flow-sp-detail__label">
                {ref.kind === 'list' ? 'List:' : 'Lookup:'}
              </span>
              <span className="flow-sp-detail__value">
                {ref.name}
                <span className="flow-sp-rule-alert__rules">{ref.usedBy.join(', ')}</span>
              </span>
            </div>
          ))}
        </>
      )}

      <h5 className="flow-side-panel__section-title">Rules ({view.rules.length})</h5>
      {view.rules.map((rule) => (
        <div
          key={rule.id ?? rule.sequence}
          className={`flow-sp-card flow-sp-rule${rule.invalidCount > 0 ? ' flow-sp-rule--invalid' : ''}`}
        >
          <div className="flow-sp-card__title">
            <span className="flow-sp-rule__seq">{rule.sequence}</span>
            {rule.name}
            {rule.tracked && <span className="flow-sp-rule__tracked">tracked</span>}
          </div>
          {rule.description && (
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Description:</span>
              <span className="flow-sp-detail__value">{rule.description}</span>
            </div>
          )}
          {rule.conditions.map((condition, i) => (
            <RuleElement key={`c${i}`} element={condition} lead={i === 0 ? rule.keyword : 'AND'} />
          ))}
          {rule.conditions.length === 0 && rule.keyword === 'ELSE' && (
            <div className="flow-sp-rule__line">
              <span className="flow-sp-rule__lead">ELSE</span>
            </div>
          )}
          {rule.actions.map((action, i) => (
            <RuleElement key={`a${i}`} element={action} lead={i === 0 ? 'THEN' : 'AND'} />
          ))}
        </div>
      ))}
    </>
  );
}

function SegTreeNodeView({ node, depth = 0 }: { node: SegTreeNode; depth?: number }) {
  return (
    <div className="flow-sp-card" style={{ marginLeft: depth * 16 }}>
      <div className="flow-sp-card__title">{node.label}</div>
      <div className="flow-sp-detail">
        <span className="flow-sp-detail__label">Type:</span>
        <span className="flow-sp-detail__value">{node.type}</span>
      </div>
      {node.booleanExpressionName && (
        <div className="flow-sp-detail">
          <span className="flow-sp-detail__label">Expression:</span>
          <span className="flow-sp-detail__value">{node.booleanExpressionName}</span>
        </div>
      )}
      {node.valueNodes?.map((vn) => (
        <div key={vn.id} className="flow-sp-card" style={{ marginLeft: 16 }}>
          <div className="flow-sp-detail">
            <span className="flow-sp-detail__label">{vn.label}:</span>
            <span className="flow-sp-detail__value">{vn.value}</span>
          </div>
          {vn.outcomeName && (
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Outcome:</span>
              <span className="flow-sp-detail__value">{vn.outcomeName}</span>
            </div>
          )}
          {vn.next && <SegTreeNodeView node={vn.next} depth={depth + 2} />}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

interface FlowSidePanelProps {
  nodeData: SidNodeData;
  /** Definitions already fetched by the page, keyed by step revision URI. */
  restApiCache?: Map<string, RestApiDefinitionDetail>;
  /** Rule sets already fetched by the page, keyed by rule set id. */
  ruleSetCache?: Map<string, RuleSetBundle>;
  onClose: () => void;
  onViewCode?: (href: string, language: string) => void;
}

export default function FlowSidePanel({ nodeData, restApiCache, ruleSetCache, onClose, onViewCode }: FlowSidePanelProps) {
  const [ruleSetBundle, setRuleSetBundle] = useState<RuleSetBundle | null>(null);
  const [modelDetail, setModelDetail] = useState<SidModelDetail | null>(null);
  const [codeFileDetail, setCodeFileDetail] = useState<CodeFileDetail | null>(null);
  const [codeFileHref, setCodeFileHref] = useState<string>('');
  const [treatmentDefs, setTreatmentDefs] = useState<TreatmentDefinitionDetail[]>([]);
  const [treatmentEligibilityRuleSets, setTreatmentEligibilityRuleSets] = useState<Map<string, RuleSetDetail>>(new Map());
  const [treatmentGroup, setTreatmentGroup] = useState<TreatmentGroupDetail | null>(null);
  const [nodeTypeDetail, setNodeTypeDetail] = useState<DecisionNodeTypeDetail | null>(null);
  const [segTreeDetail, setSegTreeDetail] = useState<SegmentationTreeDetail | null>(null);
  const [restApiDetail, setRestApiDetail] = useState<RestApiDefinitionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Escape closes the panel — unless a modal (code viewer) is open above it,
  // in which case the modal owns the key and the panel must stay put.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const step = nodeData.step;
  const colors = NODE_COLORS[nodeData.nodeType] ?? NODE_COLORS.unknown;

  /* ---- useEffect 1: Fetch details based on step type ---- */
  useEffect(() => {
    if (!step) return;

    const currentStep = step;
    const errs: string[] = [];
    let cancelled = false;

    async function fetchAll() {
      setLoading(true);
      setErrors([]);
      setRuleSetBundle(null);
      setModelDetail(null);
      setCodeFileDetail(null);
      setCodeFileHref('');
      setTreatmentDefs([]);
      setTreatmentEligibilityRuleSets(new Map());
      setTreatmentGroup(null);
      setNodeTypeDetail(null);
      setSegTreeDetail(null);
      setRestApiDetail(null);

      try {
        // Rule Set
        if (currentStep.ruleset?.id) {
          try {
            const bundle = ruleSetCache?.get(currentStep.ruleset.id)
              ?? await getRuleSetBundle(currentStep.ruleset.id);
            if (!cancelled) setRuleSetBundle(bundle);
          } catch (e) {
            errs.push(`Rule set: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // Model
        if (currentStep.model?.id) {
          try {
            const detail = await getSidModel(currentStep.model.id);
            if (!cancelled) setModelDetail(detail);
          } catch (e) {
            errs.push(`Model: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // Code file
        const codeFileLink = currentStep.links?.find(
          (l) => l.rel === 'decisionCodeFile' || l.rel === 'revisions',
        );
        const isCodeType = currentStep.customObject?.type && CODE_TYPE_LABELS[currentStep.customObject.type];
        if (codeFileLink || isCodeType) {
          try {
            const href = codeFileLink?.href ?? codeFileLink?.uri ?? currentStep.customObject?.uri ?? '';
            if (href) {
              const detail = await getCodeFileDetail(href);
              if (!cancelled) {
                setCodeFileDetail(detail);
                setCodeFileHref(href);
              }
            }
          } catch (e) {
            errs.push(`Code file: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // Decision node type (from step links)
        const dntLink = currentStep.links?.find((l) => l.rel === 'decisionNodeType');
        if (dntLink) {
          try {
            const id = extractIdFromUri(dntLink.href || dntLink.uri);
            const detail = await getDecisionNodeType(id);
            if (!cancelled) setNodeTypeDetail(detail);
          } catch (e) {
            errs.push(`Node type: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // Treatment group
        if (isTreatmentGroup(currentStep.customObject?.type)) {
          try {
            const group = await getTreatmentGroupByUri(currentStep.customObject!.uri);
            if (!cancelled) setTreatmentGroup(group);

            if (group.members?.length) {
              const defs: TreatmentDefinitionDetail[] = [];
              const eligRuleSets = new Map<string, RuleSetDetail>();

              await Promise.all(
                group.members.map(async (member) => {
                  try {
                    const def = member.definitionRevisionId
                      ? await getTreatmentDefinitionByRevision(member.definitionId, member.definitionRevisionId)
                      : await getTreatmentDefinitionByRevision(member.definitionId, member.definitionId);
                    defs.push(def);

                    if (def.eligibility?.ruleSetUri) {
                      try {
                        const rsId = extractIdFromUri(def.eligibility.ruleSetUri);
                        const rs = await getRuleSet(rsId);
                        eligRuleSets.set(def.id, rs);
                      } catch { /* eligibility rule set not critical */ }
                    }
                  } catch (e) {
                    errs.push(`Treatment ${member.definitionName ?? member.definitionId}: ${e instanceof Error ? e.message : String(e)}`);
                  }
                }),
              );

              if (!cancelled) {
                setTreatmentDefs(defs);
                setTreatmentEligibilityRuleSets(eligRuleSets);
              }
            }
          } catch (e) {
            errs.push(`Treatment group: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // REST API definition (customObject.uri is the revision URI)
        if (currentStep.customObject?.type === REST_API_DEFINITION_TYPE) {
          const uri = currentStep.customObject.uri;
          const cached = restApiCache?.get(uri);
          if (cached) {
            if (!cancelled) setRestApiDetail(cached);
          } else {
            try {
              const detail = await getRestApiDefinitionByUri(uri);
              if (!cancelled) setRestApiDetail(detail);
            } catch (e) {
              errs.push(`REST API definition: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }

        // Segmentation tree
        if (currentStep.customObject?.type === 'segmentationTree') {
          try {
            const detail = await getSegmentationTree(currentStep.customObject.uri);
            if (!cancelled) setSegTreeDetail(detail);
          } catch (e) {
            errs.push(`Segmentation tree: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } finally {
        if (!cancelled) {
          setErrors(errs);
          setLoading(false);
        }
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [step, restApiCache, ruleSetCache]);

  /* ---- useEffect 2: Check for decisionNodeType after codeFileDetail loads ---- */
  useEffect(() => {
    if (!codeFileDetail?.links) return;

    const dntLink = codeFileDetail.links.find((l) => l.rel === 'decisionNodeType');
    if (!dntLink) return;

    let cancelled = false;
    (async () => {
      try {
        const id = extractIdFromUri(dntLink.href || dntLink.uri);
        const detail = await getDecisionNodeType(id);
        if (!cancelled) setNodeTypeDetail(detail);
      } catch {
        /* non-critical */
      }
    })();
    return () => { cancelled = true; };
  }, [codeFileDetail]);

  /* ---- Derived values ---- */
  const conditionExpr = step ? buildConditionExpression(step) : '';
  const codeLanguage = step?.customObject?.type ? (CODE_TYPE_LABELS[step.customObject.type] ?? '') : '';
  const ruleSetDetail = ruleSetBundle?.detail ?? null;

  /* ---- JSX ---- */
  return (
    <div className="flow-side-panel">
      <button className="flow-side-panel__close" onClick={onClose} title="Close panel">
        &#x2715; Close
      </button>
      {/* Header */}
      <div
        className="flow-side-panel__header"
        style={{ backgroundColor: colors.bg, borderBottomColor: colors.border }}
      >
        <span
          className="flow-side-panel__type-badge"
          style={{ backgroundColor: colors.badge, color: 'var(--sas-white)' }}
        >
          {NODE_TYPE_LABELS[nodeData.nodeType] ?? nodeData.nodeType}
        </span>
        <div className="flow-side-panel__title">{nodeData.label}</div>
        {step?.customObject?.name && step.customObject.name !== nodeData.label && (
          <div className="flow-side-panel__subtitle">{step.customObject.name}</div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flow-side-panel__content">
        {loading && <Loading size="small" message="Loading details..." />}

        {errors.length > 0 && (
          <div className="flow-side-panel__alert">
            <Alert variant="error" title="Some details could not be loaded">
              <ul className="flow-side-panel__error-list">
                {errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </Alert>
          </div>
        )}

        {/* ---- Asset Descriptions ---- */}

        {/* Condition expression */}
        {(nodeData.nodeType === 'condition' || nodeData.nodeType === 'cond_expr') && conditionExpr && (
          <CollapsibleSection title="Condition">
            <div className="flow-sp-code">{conditionExpr}</div>
          </CollapsibleSection>
        )}

        {/* A/B Test */}
        {step?.abTestCases && step.abTestCases.length > 0 && (
          <CollapsibleSection title="A/B Test">
            {step.abTestType && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Type:</span>
                <span className="flow-sp-detail__value">{step.abTestType}</span>
              </div>
            )}
            {step.abTestCases.map((tc) => (
              <div key={tc.id} className="flow-sp-card">
                <div className="flow-sp-card__title">
                  {tc.label ?? tc.id}
                  {tc.role && (
                    <span className={`flow-sp-badge flow-sp-badge--${tc.role === 'champion' ? 'champion' : 'challenger'}`}>
                      {tc.role}
                    </span>
                  )}
                </div>
                {tc.percent !== undefined && (
                  <div className="flow-sp-detail">
                    <span className="flow-sp-detail__label">Percent:</span>
                    <span className="flow-sp-detail__value">{tc.percent}%</span>
                  </div>
                )}
              </div>
            ))}
          </CollapsibleSection>
        )}

        {/* Parallel Process */}
        {step?.nodes && step.nodes.length > 0 && (
          <CollapsibleSection title="Parallel Nodes">
            {step.nodes.map((pn) => (
              <div key={pn.id} className="flow-sp-card">
                <div className="flow-sp-card__title">{pn.name}</div>
                {pn.uri && (
                  <div className="flow-sp-detail">
                    <span className="flow-sp-detail__label">URI:</span>
                    <span className="flow-sp-detail__value">{pn.uri}</span>
                  </div>
                )}
              </div>
            ))}
          </CollapsibleSection>
        )}

        {/* Record Contact */}
        {step?.recordContact && (
          <CollapsibleSection title="Record Contact">
            {step.recordContact.name && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Name:</span>
                <span className="flow-sp-detail__value">{step.recordContact.name}</span>
              </div>
            )}
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Rule Fired Tracking:</span>
              <span className="flow-sp-detail__value">{step.recordContact.ruleFiredTracking ? 'Yes' : 'No'}</span>
            </div>
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Path Tracking:</span>
              <span className="flow-sp-detail__value">{step.recordContact.pathTracking ? 'Yes' : 'No'}</span>
            </div>
            {step.recordContact.responseTrackingVariableName && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Response Tracking Variable:</span>
                <span className="flow-sp-detail__value">{step.recordContact.responseTrackingVariableName}</span>
              </div>
            )}
            {step.recordContact.treatmentDatagridTerm && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Treatment Datagrid Term:</span>
                <span className="flow-sp-detail__value">{step.recordContact.treatmentDatagridTerm}</span>
              </div>
            )}
            {step.recordContact.channelTerm && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Channel Term:</span>
                <span className="flow-sp-detail__value">{step.recordContact.channelTerm}</span>
              </div>
            )}
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Exclude from Contact Aggregation:</span>
              <span className="flow-sp-detail__value">{step.recordContact.excludeFromContactAggregation ? 'Yes' : 'No'}</span>
            </div>
          </CollapsibleSection>
        )}

        {/* Segmentation Tree */}
        {segTreeDetail && (
          <CollapsibleSection title="Segmentation Tree">
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Name:</span>
              <span className="flow-sp-detail__value">{segTreeDetail.name}</span>
            </div>
            {segTreeDetail.description && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Description:</span>
                <span className="flow-sp-detail__value">{segTreeDetail.description}</span>
              </div>
            )}
            {segTreeDetail.majorRevision !== undefined && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Version:</span>
                <span className="flow-sp-detail__value">{segTreeDetail.majorRevision}.{segTreeDetail.minorRevision ?? 0}</span>
              </div>
            )}
            {segTreeDetail.outcomes && segTreeDetail.outcomes.length > 0 && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Outcomes:</span>
                <span className="flow-sp-detail__value">
                  {segTreeDetail.outcomes.map((o) => o.name).join(', ')}
                </span>
              </div>
            )}
            {segTreeDetail.booleanExpressions && segTreeDetail.booleanExpressions.length > 0 && (
              <>
                <h5 className="flow-side-panel__section-title">Boolean Expressions</h5>
                {segTreeDetail.booleanExpressions.map((be, i) => (
                  <div key={i} className="flow-sp-card">
                    <div className="flow-sp-card__title">{be.name}</div>
                    <div className="flow-sp-code">{be.expression}</div>
                  </div>
                ))}
              </>
            )}
            {segTreeDetail.signature && segTreeDetail.signature.length > 0 && (
              <>
                <h5 className="flow-side-panel__section-title">Signature</h5>
                <VariableTable variables={segTreeDetail.signature} />
              </>
            )}
            {segTreeDetail.node && (
              <>
                <h5 className="flow-side-panel__section-title">Decision Tree</h5>
                <SegTreeNodeView node={segTreeDetail.node} />
              </>
            )}
          </CollapsibleSection>
        )}

        {/* Code File */}
        {codeFileDetail && (
          <CollapsibleSection title="Code File">
            {onViewCode && codeFileHref && (
              <Button
                variant="primary"
                size="small"
                className="flow-sp-view-code-btn"
                onClick={() => onViewCode(codeFileHref, codeLanguage || 'text')}
              >
                View Full Code
              </Button>
            )}
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Name:</span>
              <span className="flow-sp-detail__value">{codeFileDetail.name ?? '—'}</span>
            </div>
            {codeFileDetail.description && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Description:</span>
                <span className="flow-sp-detail__value">{codeFileDetail.description}</span>
              </div>
            )}
            {codeFileDetail.type && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Type:</span>
                <span className="flow-sp-detail__value">{CODE_TYPE_LABELS[codeFileDetail.type] ?? codeFileDetail.type}</span>
              </div>
            )}
            {codeFileDetail.status && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Status:</span>
                <span className="flow-sp-detail__value">{codeFileDetail.status}</span>
              </div>
            )}
            {codeFileDetail.majorRevision !== undefined && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Version:</span>
                <span className="flow-sp-detail__value">{codeFileDetail.majorRevision}.{codeFileDetail.minorRevision ?? 0}</span>
              </div>
            )}
            {codeFileDetail.signature && codeFileDetail.signature.length > 0 && (
              <>
                <h5 className="flow-side-panel__section-title">Signature</h5>
                <VariableTable variables={codeFileDetail.signature} />
              </>
            )}
          </CollapsibleSection>
        )}

        {/* REST API definition */}
        {restApiDetail && (
          <CollapsibleSection title="REST API">
            {(() => {
              // Deep-link from the step URI: its first UUID is the definition id.
              // restApiDetail.id is the revision id when fetched by revision URI.
              const uri = step?.customObject?.uri;
              const link = uri ? buildDeepLink('restApiDefinition', uri) : null;
              return link ? <FlowDeepLink url={link.url} label={link.label} /> : null;
            })()}
            <div className="flow-sp-rest-call">
              <span className={`flow-sp-method flow-sp-method--${(restApiDetail.method ?? '').toLowerCase()}`}>
                {restApiDetail.method ?? '\u2014'}
              </span>
              <code className="flow-sp-rest-uri">
                <TemplateText text={restApiDetail.uriTemplate ?? ''} />
              </code>
            </div>
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Name:</span>
              <span className="flow-sp-detail__value">{restApiDetail.name}</span>
            </div>
            {restApiDetail.description && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Description:</span>
                <span className="flow-sp-detail__value">{restApiDetail.description}</span>
              </div>
            )}
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Authorization:</span>
              <span className="flow-sp-detail__value">
                {authTypeLabel(restApiDetail.authorization?.authorizationType)}
              </span>
            </div>
            {restApiDetail.majorRevision !== undefined && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Version:</span>
                <span className="flow-sp-detail__value">
                  {restApiDetail.majorRevision}.{restApiDetail.minorRevision ?? 0}
                  {restApiDetail.locked ? ' (locked)' : ''}
                </span>
              </div>
            )}
            {restApiDetail.folderType === 'trashFolder' && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Status:</span>
                <span className="flow-sp-detail__value flow-sp-detail__value--invalid">
                  Definition is in the trash
                </span>
              </div>
            )}

            {restApiDetail.queryParams && restApiDetail.queryParams.length > 0 && (
              <>
                <h5 className="flow-side-panel__section-title">Query Parameters</h5>
                <ParamTable params={restApiDetail.queryParams} mappings={step?.mappings} />
              </>
            )}
            {restApiDetail.requestHeaders && restApiDetail.requestHeaders.length > 0 && (
              <>
                <h5 className="flow-side-panel__section-title">Request Headers</h5>
                <ParamTable params={restApiDetail.requestHeaders} mappings={step?.mappings} />
              </>
            )}
            {restApiDetail.responseHeaders && restApiDetail.responseHeaders.length > 0 && (
              <>
                <h5 className="flow-side-panel__section-title">Response Headers</h5>
                <ParamTable params={restApiDetail.responseHeaders} mappings={step?.mappings} />
              </>
            )}
            {restApiDetail.requestBody && restApiDetail.requestBody.trim() !== '' && (
              <>
                <h5 className="flow-side-panel__section-title">
                  Request Body{restApiDetail.requestBodyFormat ? ` (${restApiDetail.requestBodyFormat})` : ''}
                </h5>
                <div className="flow-sp-code">{restApiDetail.requestBody}</div>
              </>
            )}
            {restApiDetail.signature && restApiDetail.signature.length > 0 && (
              <>
                <h5 className="flow-side-panel__section-title">Signature</h5>
                <VariableTable variables={restApiDetail.signature} />
              </>
            )}
          </CollapsibleSection>
        )}

        {/* Sub-Decision */}
        {nodeData.subDecisionId && (
          <CollapsibleSection title="Sub-Decision">
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Decision ID:</span>
              <span className="flow-sp-detail__value">{nodeData.subDecisionId}</span>
            </div>
            {(() => {
              const link = buildDeepLink('decision', nodeData.subDecisionId);
              return link ? <FlowDeepLink url={link.url} label={link.label} /> : null;
            })()}
          </CollapsibleSection>
        )}

        {/* Rule Set */}
        {ruleSetDetail && (
          <CollapsibleSection title="Rule Set">
            {(() => {
              const link = buildRuleSetDeepLink(ruleSetDetail.id);
              return link ? <FlowDeepLink url={link.url} label={link.label} /> : null;
            })()}
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Name:</span>
              <span className="flow-sp-detail__value">{ruleSetDetail.name}</span>
            </div>
            {ruleSetDetail.description && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Description:</span>
                <span className="flow-sp-detail__value">{ruleSetDetail.description}</span>
              </div>
            )}
            {ruleSetDetail.ruleSetType && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Type:</span>
                <span className="flow-sp-detail__value">{ruleSetDetail.ruleSetType}</span>
              </div>
            )}
            {ruleSetDetail.majorRevision !== undefined && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Version:</span>
                <span className="flow-sp-detail__value">{ruleSetDetail.majorRevision}.{ruleSetDetail.minorRevision ?? 0}</span>
              </div>
            )}
            {ruleSetDetail.status && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Status:</span>
                <span className="flow-sp-detail__value">{ruleSetDetail.status}</span>
              </div>
            )}
            {ruleSetDetail.signature && ruleSetDetail.signature.length > 0 && (
              <>
                <h5 className="flow-side-panel__section-title">Signature</h5>
                <VariableTable variables={ruleSetDetail.signature} />
              </>
            )}
            {ruleSetBundle && ruleSetBundle.rules.length > 0 && <RuleChain bundle={ruleSetBundle} />}
          </CollapsibleSection>
        )}

        {/* Model */}
        {modelDetail && (
          <CollapsibleSection title="Model">
            {(() => {
              const link = buildModelDeepLink(modelDetail.id);
              return link ? <FlowDeepLink url={link.url} label={link.label} /> : null;
            })()}
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Name:</span>
              <span className="flow-sp-detail__value">{modelDetail.name}</span>
            </div>
            {modelDetail.description && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Description:</span>
                <span className="flow-sp-detail__value">{modelDetail.description}</span>
              </div>
            )}
            {modelDetail.algorithm && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Algorithm:</span>
                <span className="flow-sp-detail__value">{modelDetail.algorithm}</span>
              </div>
            )}
            {modelDetail.tool && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Tool:</span>
                <span className="flow-sp-detail__value">{modelDetail.tool}{modelDetail.toolVersion ? ` (${modelDetail.toolVersion})` : ''}</span>
              </div>
            )}
            {modelDetail.scoreCodeType && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Score Code Type:</span>
                <span className="flow-sp-detail__value">{modelDetail.scoreCodeType}</span>
              </div>
            )}
            {modelDetail.targetVariable && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Target Variable:</span>
                <span className="flow-sp-detail__value">{modelDetail.targetVariable}</span>
              </div>
            )}
            {modelDetail.function && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Function:</span>
                <span className="flow-sp-detail__value">{modelDetail.function}</span>
              </div>
            )}
            {modelDetail.champion !== undefined && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Champion:</span>
                <span className={`flow-sp-badge flow-sp-badge--${modelDetail.champion ? 'champion' : 'challenger'}`}>
                  {modelDetail.champion ? 'Yes' : 'No'}
                </span>
              </div>
            )}
            {modelDetail.projectName && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Project:</span>
                <span className="flow-sp-detail__value">{modelDetail.projectName}{modelDetail.projectVersionName ? ` v${modelDetail.projectVersionName}` : ''}</span>
              </div>
            )}
            {modelDetail.inputVariables && modelDetail.inputVariables.length > 0 && (
              <>
                <h5 className="flow-side-panel__section-title">Input Variables ({modelDetail.inputVariables.length})</h5>
                <table className="flow-sp-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Type</th>
                      <th>Length</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelDetail.inputVariables.map((v, i) => (
                      <tr key={i} title={v.description || undefined}>
                        <td>{v.name}</td>
                        <td>{v.role ?? ''}</td>
                        <td>{v.type ?? ''}</td>
                        <td>{displayLength(v.length, v.type)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {modelDetail.outputVariables && modelDetail.outputVariables.length > 0 && (
              <>
                <h5 className="flow-side-panel__section-title">Output Variables ({modelDetail.outputVariables.length})</h5>
                <table className="flow-sp-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Type</th>
                      <th>Length</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelDetail.outputVariables.map((v, i) => (
                      <tr key={i} title={v.description || undefined}>
                        <td>{v.name}</td>
                        <td>{v.role ?? ''}</td>
                        <td>{v.type ?? ''}</td>
                        <td>{displayLength(v.length, v.type)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {modelDetail.properties && modelDetail.properties.length > 0 && (
              <>
                <h5 className="flow-side-panel__section-title">Properties</h5>
                <table className="flow-sp-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelDetail.properties.map((p, i) => (
                      <tr key={i}>
                        <td>{p.name}</td>
                        <td>{p.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </CollapsibleSection>
        )}

        {/* Treatment Group */}
        {treatmentGroup && (
          <CollapsibleSection title="Treatment Group">
            {(() => {
              const link = step?.customObject
                ? buildCustomObjectDeepLink(step.customObject.type, step.customObject.uri)
                : null;
              return link ? <FlowDeepLink url={link.url} label={link.label} /> : null;
            })()}
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Name:</span>
              <span className="flow-sp-detail__value">{treatmentGroup.name}</span>
            </div>
            {treatmentGroup.description && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Description:</span>
                <span className="flow-sp-detail__value">{treatmentGroup.description}</span>
              </div>
            )}
            {treatmentGroup.majorRevision !== undefined && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Version:</span>
                <span className="flow-sp-detail__value">{treatmentGroup.majorRevision}.{treatmentGroup.minorRevision ?? 0}</span>
              </div>
            )}
            {treatmentGroup.activationStatus && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Activation:</span>
                <span className={`flow-sp-badge flow-sp-badge--${treatmentGroup.activationStatus === 'active' ? 'active' : 'inactive'}`}>
                  {treatmentGroup.activationStatus}
                </span>
              </div>
            )}
            {treatmentDefs.length > 0 && (
              <>
                <h5 className="flow-side-panel__section-title">Treatment Definitions ({treatmentDefs.length})</h5>
                {treatmentDefs.map((def) => (
                  <div key={def.id} className="flow-sp-card">
                    <div className="flow-sp-card__title">{def.name}</div>
                    {def.description && (
                      <div className="flow-sp-detail">
                        <span className="flow-sp-detail__label">Description:</span>
                        <span className="flow-sp-detail__value">{def.description}</span>
                      </div>
                    )}
                    {def.status && (
                      <div className="flow-sp-detail">
                        <span className="flow-sp-detail__label">Status:</span>
                        <span className="flow-sp-detail__value">{def.status}</span>
                      </div>
                    )}
                    {def.attributes && def.attributes.length > 0 && (
                      <>
                        <h6 className="flow-side-panel__section-title">Attributes</h6>
                        <table className="flow-sp-table">
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Default</th>
                              <th>Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {def.attributes.map((attr, ai) => (
                              <tr key={ai}>
                                <td>{attr.name}</td>
                                <td>{attr.defaultValue !== undefined ? String(attr.defaultValue) : '—'}</td>
                                <td>{attr.valueConstraints?.dataType ?? ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                    {def.eligibility && (
                      <div className="flow-sp-detail">
                        <span className="flow-sp-detail__label">Eligibility Rule Set:</span>
                        <span className="flow-sp-detail__value">
                          {treatmentEligibilityRuleSets.get(def.id)?.name ?? def.eligibility.ruleSetName ?? def.eligibility.ruleSetUri ?? '—'}
                        </span>
                      </div>
                    )}
                    {def.eligibility?.startDate && (
                      <div className="flow-sp-detail">
                        <span className="flow-sp-detail__label">Start Date:</span>
                        <span className="flow-sp-detail__value">{def.eligibility.startDate}</span>
                      </div>
                    )}
                    {def.eligibility?.endDate && (
                      <div className="flow-sp-detail">
                        <span className="flow-sp-detail__label">End Date:</span>
                        <span className="flow-sp-detail__value">{def.eligibility.endDate}</span>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </CollapsibleSection>
        )}

        {/* Decision Node Type */}
        {nodeTypeDetail && (
          <CollapsibleSection title="Decision Node Type">
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Name:</span>
              <span className="flow-sp-detail__value">{nodeTypeDetail.name}</span>
            </div>
            {nodeTypeDetail.description && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Description:</span>
                <span className="flow-sp-detail__value">{nodeTypeDetail.description}</span>
              </div>
            )}
            {nodeTypeDetail.type && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Type:</span>
                <span className="flow-sp-detail__value">{nodeTypeDetail.type}</span>
              </div>
            )}
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Has Inputs:</span>
              <span className="flow-sp-detail__value">{nodeTypeDetail.hasInputs ? 'Yes' : 'No'}</span>
            </div>
            <div className="flow-sp-detail">
              <span className="flow-sp-detail__label">Has Outputs:</span>
              <span className="flow-sp-detail__value">{nodeTypeDetail.hasOutputs ? 'Yes' : 'No'}</span>
            </div>
            {nodeTypeDetail.hasProperties && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Has Properties:</span>
                <span className="flow-sp-detail__value">Yes</span>
              </div>
            )}
          </CollapsibleSection>
        )}

        {/* API Links (merged into asset descriptions) */}
        {step?.links && step.links.length > 0 && (
          <div className="flow-sp-links-list">
            {step.links.map((link, i) => {
              const uri = link.uri || link.href;
              const deepLink = uri ? buildDeepLinkFromUri(uri) : null;
              return (
                <div key={i} className="flow-sp-link-item">
                  {deepLink && <FlowDeepLink url={deepLink.url} label={deepLink.label} />}
                  {uri && (
                    <a
                      href={uri}
                      className="flow-sp-link-uri"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => {
                        e.preventDefault();
                        window.open(uri.startsWith('http') ? uri : `${getSasViyaUrl()}${uri}`, '_blank');
                      }}
                    >
                      {uri}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ---- Mappings ---- */}
        {step?.mappings && step.mappings.length > 0 && (
          <CollapsibleSection title="Mappings">
            {step.mappingDataGridName && (
              <div className="flow-sp-detail">
                <span className="flow-sp-detail__label">Data Grid:</span>
                <span className="flow-sp-detail__value">{step.mappingDataGridName}</span>
              </div>
            )}
            <table className="flow-sp-table">
              <thead>
                <tr>
                  <th>Decision Term</th>
                  <th>Direction</th>
                  <th>Step Term</th>
                </tr>
              </thead>
              <tbody>
                {step.mappings.map((m: StepMapping, i: number) => (
                  <tr key={m.id ?? i}>
                    <td>{m.targetDecisionTermName}</td>
                    <td>
                      <span className={directionBadgeClass(m.direction)}>
                        {directionLabel(m.direction)}
                      </span>
                    </td>
                    <td>{m.stepTermName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CollapsibleSection>
        )}

        {/* ---- Variable Assignments ---- */}
        {step?.assignments && step.assignments.length > 0 && (
          <CollapsibleSection title="Variable Assignments">
            <table className="flow-sp-table">
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Value</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {step.assignments.map((a: VariableAssignment) => (
                  <tr key={a.id}>
                    <td>{a.variableName}</td>
                    <td className="flow-sp-code">{a.value ?? ''}</td>
                    <td>{a.dataType ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CollapsibleSection>
        )}

        {/* ---- Raw JSON ---- */}
        {step && (
          <CollapsibleSection title="Raw JSON" defaultOpen={false}>
            <RawStepJson step={step} />
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}
