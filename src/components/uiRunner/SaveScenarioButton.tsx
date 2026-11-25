// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Module, Step, Variable } from '../../types';
import { DecisionSignatureVariable, getDecisionSignature } from '../../api/modules';
import { SaveScenarioDialog } from '../scoring/SaveScenarioDialog';

interface Props {
  module: Module;
  step: Step;
  /** The values the last run sent, keyed by the step's input names. */
  inputs: Record<string, unknown>;
  /** What MAS returned for that run. */
  outputs: Variable[];
}

/** The decision a module was published from, or null. */
export const decisionSourceOf = (module: Module | null | undefined): string | null => {
  const uri = module?.properties?.find(p => p.name === 'sourceURI')?.value ?? '';
  return uri.startsWith('/decisions/flows/') ? uri : null;
};

/**
 * "Save as test case": the last run's inputs and results saved as a scenario
 * of the decision in SAS Intelligent Decisioning, through the same dialog as
 * the Execute page. The app user needs write access to the folder they pick.
 */
export const SaveScenarioButton: React.FC<Props> = ({ module, step, inputs, outputs }) => {
  const [open, setOpen] = useState(false);
  const [signature, setSignature] = useState<DecisionSignatureVariable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const source = decisionSourceOf(module);
  if (!source) return null;

  const openDialog = async () => {
    setError(null);
    try {
      setSignature(signature ?? await getDecisionSignature(source));
      setOpen(true);
    } catch (e) {
      setError(`Could not read the decision: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <>
      <button type="button" className="sas-button sas-button--secondary sas-button--small" onClick={() => void openDialog()}>
        Save as test case
      </button>
      {error && <span className="ui-runner__batch-error" role="alert">{error}</span>}
      {open && signature && (
        <SaveScenarioDialog
          module={module}
          sourceURI={source}
          inputValues={inputs}
          inputParameters={step.inputs ?? []}
          outputValues={outputs}
          outputParameters={step.outputs ?? []}
          decisionSignature={signature}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};
