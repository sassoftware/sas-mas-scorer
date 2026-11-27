// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Module } from '../../types';
import { getSidModel, SidModelDetail } from '../../api/sidModels';
import { getSasViyaUrl } from '../../api/client';

/** The SAS Model Manager model a module was published from, or null. */
export function modelIdOf(module: Module | null | undefined): string | null {
  const uri = module?.properties?.find(p => p.name === 'sourceURI')?.value ?? '';
  return uri.match(/^\/modelRepository\/models\/([0-9a-f-]+)/i)?.[1] ?? null;
}

const when = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const roleText = (m: SidModelDetail) => {
  const role = String(m.role ?? '').toLowerCase();
  if (role === 'champion') return 'Champion';
  if (role === 'challenger') return 'Challenger';
  return 'Neither champion nor challenger';
};

/**
 * The model behind a model module, read from SAS Model Manager when the app
 * opens: name, project, version, role, algorithm, target, tool and the
 * selection statistic, with a note when the model changed after the module
 * was published. Only what the model repository says; nothing is computed.
 */
export const ModelInfoPanel: React.FC<{ module: Module }> = ({ module }) => {
  const id = modelIdOf(module);
  const [model, setModel] = useState<SidModelDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    setModel(null);
    setError(null);
    getSidModel(id)
      .then(m => { if (live) setModel(m); })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [id]);

  if (!id) return null;

  const rows: [string, React.ReactNode][] = model ? [
    ['Model', model.name],
    ['Project', [model.projectName, model.projectVersionName].filter(Boolean).join(' · ') || null],
    ['Model version', model.modelVersionName ?? null],
    ['Role', roleText(model)],
    ['Algorithm', [model.algorithm, model.function].filter(Boolean).join(' · ') || null],
    ['Target', model.targetVariable
      ? `${model.targetVariable}${model.targetEvent ? ` (event: ${String(model.targetEvent)})` : ''}`
      : null],
    ['Built with', model.tool ? `${model.tool}${model.toolVersion ? ` (${model.toolVersion})` : ''}` : null],
    ['Selection statistic', model.selectionStatistic
      ? `${String(model.selectionStatistic).replace(/^_|_$/g, '')} = ${Number(model.selectionStatisticValue).toLocaleString(undefined, { maximumFractionDigits: 4 })}`
      : null],
    ['Last changed', when(model.modifiedTimeStamp)],
  ] : [];
  const changedAfterPublish = !!model?.modifiedTimeStamp && !!module.creationTimeStamp
    && Date.parse(model.modifiedTimeStamp) > Date.parse(module.creationTimeStamp);

  return (
    <section className="ui-runner__model-info" aria-labelledby={`model-info-${module.id}`}>
      <div className="ui-runner__model-info-head">
        <h3 id={`model-info-${module.id}`}>Model information</h3>
        <a
          href={`${getSasViyaUrl()}/SASModelManager/models/${id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in SAS Model Manager
        </a>
      </div>
      {error && <p className="ui-runner__model-info-note">Could not read the model from SAS Model Manager: {error}</p>}
      {!model && !error && <p className="ui-runner__model-info-note">Reading the model from SAS Model Manager…</p>}
      {model && (
        <>
          <dl className="ui-runner__model-info-list">
            {rows.filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {changedAfterPublish && (
            <p className="ui-runner__model-info-note">
              The model was changed in SAS Model Manager after this module was published ({when(module.creationTimeStamp)}).
              The module may not run the model as it is now.
            </p>
          )}
        </>
      )}
    </section>
  );
};
