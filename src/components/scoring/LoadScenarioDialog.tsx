// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Badge } from '../common/Badge';
import { Loading } from '../common/Loading';
import {
  listDecisionScenarios,
  getScoreDefinition,
  ScoreDefinitionSummary,
} from '../../api/scoreDefinitions';
import { getDecisionSignature, DecisionSignatureVariable } from '../../api/modules';
import { StepParameter } from '../../types';

interface LoadScenarioDialogProps {
  sourceURI: string;
  inputParameters: StepParameter[];
  onLoad: (values: Record<string, unknown>) => void;
  onClose: () => void;
}

/**
 * Build a reverse name lookup: decision variable name → MAS input parameter name.
 *
 * The save flow maps MAS names → decision names (stripping trailing _ and matching
 * case-insensitively). Loading reverses this: we need to map the decision variable
 * names stored in the score definition back to the MAS parameter names.
 */
function buildReverseNameLookup(
  signature: DecisionSignatureVariable[],
  masParams: StepParameter[]
): (decisionName: string) => string | null {
  // Build decision name (lowercased) → MAS param name
  const decisionToMas = new Map<string, string>();

  for (const masParam of masParams) {
    const masLower = masParam.name.toLowerCase();

    // Try exact match against signature
    const exactMatch = signature.find(s => s.name.toLowerCase() === masLower);
    if (exactMatch) {
      decisionToMas.set(exactMatch.name.toLowerCase(), masParam.name);
      continue;
    }

    // Try after stripping trailing _ from MAS name
    if (masParam.name.endsWith('_')) {
      const stripped = masParam.name.slice(0, -1).toLowerCase();
      const strippedMatch = signature.find(s => s.name.toLowerCase() === stripped);
      if (strippedMatch) {
        decisionToMas.set(strippedMatch.name.toLowerCase(), masParam.name);
        continue;
      }
    }

    // Fallback: map the MAS name to itself (lowercase key)
    decisionToMas.set(masLower, masParam.name);
  }

  return (decisionName: string): string | null => {
    // Try direct lookup
    const direct = decisionToMas.get(decisionName.toLowerCase());
    if (direct) return direct;

    // Try appending _ (reverse of the stripping logic)
    const withSuffix = decisionToMas.get(decisionName.toLowerCase() + '_');
    if (withSuffix) return withSuffix;

    return null;
  };
}

/**
 * Unwrap a mapping value back to a plain JS value suitable for InputForm.
 */
function unwrapMappingValue(value: unknown, paramType: string): unknown {
  if (value === null || value === undefined) return null;

  // Wrapped date/datetime objects → plain string
  if (typeof value === 'object' && value !== null && 'type' in value && 'value' in value) {
    return (value as { value: unknown }).value;
  }

  // JSON-stringified objects for datagrid types → parse back
  if (typeof value === 'string' && paramType.endsWith('Array')) {
    try {
      return JSON.parse(value);
    } catch {
      // Not JSON, return as-is
    }
  }

  return value;
}

export const LoadScenarioDialog: React.FC<LoadScenarioDialogProps> = ({
  sourceURI,
  inputParameters,
  onLoad,
  onClose,
}) => {
  const [scenarios, setScenarios] = useState<ScoreDefinitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<DecisionSignatureVariable[]>([]);

  // Extract decision flow ID from sourceURI
  const flowId = sourceURI.match(/\/decisions\/flows\/([a-f0-9-]+)/)?.[1] ?? '';

  // Load scenarios and decision signature on mount
  useEffect(() => {
    if (!flowId) {
      setError('Could not determine decision flow ID');
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const [scenarioList, sig] = await Promise.all([
          listDecisionScenarios(flowId),
          getDecisionSignature(sourceURI).catch(() => []),
        ]);
        setScenarios(scenarioList);
        setSignature(sig);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load scenarios');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [flowId, sourceURI]);

  const handleSelectScenario = useCallback(async (scenario: ScoreDefinitionSummary) => {
    setLoadingDetail(true);
    setError(null);

    try {
      const detail = await getScoreDefinition(scenario.id);
      const resolveName = buildReverseNameLookup(signature, inputParameters);

      // Build a lookup of MAS param name → type for value unwrapping
      const paramTypeMap = new Map<string, string>();
      for (const p of inputParameters) {
        paramTypeMap.set(p.name, p.type);
      }

      // Extract static mappings and map back to MAS input parameter names
      const values: Record<string, unknown> = {};

      for (const mapping of detail.mappings) {
        if (mapping.mappingType !== 'static') continue;

        const masParamName = resolveName(mapping.variableName);
        if (!masParamName) continue;

        const paramType = paramTypeMap.get(masParamName) ?? 'string';
        values[masParamName] = unwrapMappingValue(mapping.mappingValue, paramType);
      }

      onLoad(values);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scenario details');
    } finally {
      setLoadingDetail(false);
    }
  }, [signature, inputParameters, onLoad, onClose]);

  return (
    <div className="save-scenario-overlay" onClick={onClose}>
      <div className="save-scenario-dialog" onClick={e => e.stopPropagation()}>
        <div className="save-scenario-dialog__header">
          <h3>Load Scenario</h3>
          <button className="save-scenario-dialog__close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="save-scenario-dialog__body">
          {loading && <Loading message="Loading scenarios..." />}

          {error && <Alert variant="error">{error}</Alert>}

          {!loading && scenarios.length === 0 && !error && (
            <div className="load-scenario__empty">
              <p>No scenarios found for this decision.</p>
              <p className="load-scenario__empty-hint">
                Scenarios can be created from the "Save as Scenario" button after executing a score,
                or directly in SAS Intelligent Decisioning.
              </p>
            </div>
          )}

          {!loading && scenarios.length > 0 && (
            <div className="load-scenario__list">
              {scenarios.map(scenario => (
                <button
                  key={scenario.id}
                  className="load-scenario__item"
                  onClick={() => handleSelectScenario(scenario)}
                  disabled={loadingDetail}
                >
                  <div className="load-scenario__item-main">
                    <div className="load-scenario__item-name">{scenario.name}</div>
                    {scenario.description && (
                      <div className="load-scenario__item-desc">{scenario.description}</div>
                    )}
                  </div>
                  <div className="load-scenario__item-meta">
                    <Badge variant="info" size="small">Scenario</Badge>
                    <span className="load-scenario__item-author">{scenario.createdBy}</span>
                    <span className="load-scenario__item-date">
                      {new Date(scenario.modifiedTimeStamp).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {loadingDetail && (
            <div className="load-scenario__loading-overlay">
              <Loading message="Loading scenario values..." />
            </div>
          )}

          <div className="save-scenario-dialog__actions">
            <Button variant="tertiary" onClick={onClose} disabled={loadingDetail}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
