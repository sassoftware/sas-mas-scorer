// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useMemo, useEffect } from 'react';
import { Module, Step, Submodule, getModuleType } from '../../types';
import { Card, CardHeader, CardBody } from '../common/Card';
import { Badge, StatusBadge } from '../common/Badge';
import { Button } from '../common/Button';
import { Loading } from '../common/Loading';
import { Alert } from '../common/Alert';
import { DataTable, Column } from '../common/DataTable';
import { PageHeader } from '../layout/Layout';
import { getSasViyaUrl } from '../../config';
import { getEntries, Entry } from '../../api';

interface ModuleDetailsProps {
  module: Module;
  steps: Step[];
  submodules: Submodule[];
  loadingSteps: boolean;
  loadingSubmodules: boolean;
  onSelectStep: (step: Step) => void;
  onBack: () => void;
  onDelete: (moduleId: string) => Promise<void>;
}

export const ModuleDetails: React.FC<ModuleDetailsProps> = ({
  module,
  steps,
  submodules,
  loadingSteps,
  loadingSubmodules,
  onSelectStep,
  onBack,
  onDelete,
}) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Entries state for Data type modules
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  // Determine module type
  const moduleType = useMemo(() => getModuleType(module), [module]);

  // Get sourceURI for entries fetch
  const sourceURI = useMemo(() => {
    return module.properties?.find(p => p.name === 'sourceURI')?.value ?? null;
  }, [module.properties]);

  // Fetch entries for Data type modules
  useEffect(() => {
    if (moduleType !== 'Data' || !sourceURI) {
      setEntries([]);
      return;
    }

    const fetchEntries = async () => {
      setLoadingEntries(true);
      setEntriesError(null);
      try {
        const response = await getEntries(sourceURI);
        setEntries(response.items ?? []);
      } catch (err) {
        setEntriesError(err instanceof Error ? err.message : 'Failed to load entries');
        setEntries([]);
      } finally {
        setLoadingEntries(false);
      }
    };

    fetchEntries();
  }, [moduleType, sourceURI]);

  // Extract source application link from sourceURI property
  const sourceLink = useMemo(() => {
    const sourceURI = module.properties?.find(p => p.name === 'sourceURI')?.value;
    if (!sourceURI) return null;

    const baseUrl = getSasViyaUrl();

    // Check for Intelligent Decisioning source
    if (sourceURI.startsWith('/decisions/flows/')) {
      // Format: /decisions/flows/{uuid}/revisions/{revisionUuid}
      const match = sourceURI.match(/\/decisions\/flows\/([a-f0-9-]+)/);
      if (match) {
        return {
          url: `${baseUrl}/SASDecisionManager/decisions/${match[1]}`,
          label: 'Open in SAS Intelligent Decisioning',
        };
      }
    }

    // Check for Model Manager source
    if (sourceURI.startsWith('/modelRepository/models/')) {
      // Format: /modelRepository/models/{uuid}
      const match = sourceURI.match(/\/modelRepository\/models\/([a-f0-9-]+)/);
      if (match) {
        return {
          url: `${baseUrl}/SASModelManager/models/${match[1]}`,
          label: 'Open in SAS Model Manager',
        };
      }
    }

    return null;
  }, [module.properties]);

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
    setDeleteError(null);
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(module.id);
      // onDelete should handle navigation back to list
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete module');
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
    setDeleteError(null);
  };

  const stepColumns: Column<Step>[] = [
    {
      key: 'id',
      header: 'Step ID',
      width: '25%',
      render: (step) => <strong>{step.id}</strong>,
    },
    {
      key: 'inputs',
      header: 'Inputs',
      width: '15%',
      align: 'center',
      render: (step) => <Badge variant="info">{step.inputs?.length ?? 0}</Badge>,
    },
    {
      key: 'outputs',
      header: 'Outputs',
      width: '15%',
      align: 'center',
      render: (step) => <Badge variant="success">{step.outputs?.length ?? 0}</Badge>,
    },
    {
      key: 'description',
      header: 'Description',
      width: '30%',
      render: (step) => (
        <span className="truncate">{step.description || '-'}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '15%',
      align: 'center',
      render: (step) => (
        <Button
          variant="primary"
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onSelectStep(step);
          }}
        >
          Execute
        </Button>
      ),
    },
  ];

  const submoduleColumns: Column<Submodule>[] = [
    {
      key: 'name',
      header: 'Name',
      width: '30%',
      render: (sub) => <strong>{sub.name}</strong>,
    },
    {
      key: 'language',
      header: 'Language',
      width: '20%',
      render: (sub) => <Badge variant="info">{sub.language.toUpperCase()}</Badge>,
    },
    {
      key: 'description',
      header: 'Description',
      width: '50%',
      render: (sub) => sub.description || '-',
    },
  ];

  return (
    <div className="module-details">
      <PageHeader
        title={module.name}
        subtitle={`Module ID: ${module.id}`}
        breadcrumbs={[
          { label: 'Modules', onClick: onBack },
          { label: module.name },
        ]}
        actions={
          <Button variant="tertiary" onClick={onBack}>
            Back to List
          </Button>
        }
      />

      <div className="module-details__content">
        {/* Module Info Card - Full Width */}
        <Card className="module-details__info-card">
          <CardHeader>
            <h3>Module Information</h3>
          </CardHeader>
          <CardBody>
            <dl className="module-details__info-list module-details__info-list--wide">
              <div className="module-details__info-item">
                <dt>Status</dt>
                <dd>
                  <StatusBadge status={module.scope} />
                </dd>
              </div>
              <div className="module-details__info-item">
                <dt>Type</dt>
                <dd>
                  <Badge variant={
                    moduleType === 'Model' ? 'info' :
                    moduleType === 'Decision' ? 'success' :
                    moduleType === 'Data' ? 'warning' : 'default'
                  }>{moduleType}</Badge>
                </dd>
              </div>
              <div className="module-details__info-item">
                <dt>Revision</dt>
                <dd>v{module.revision}</dd>
              </div>
              <div className="module-details__info-item">
                <dt>Created</dt>
                <dd>{new Date(module.creationTimeStamp).toLocaleString()}</dd>
              </div>
              {module.createdBy && (
                <div className="module-details__info-item">
                  <dt>Created By</dt>
                  <dd>{module.createdBy}</dd>
                </div>
              )}
              <div className="module-details__info-item">
                <dt>Modified</dt>
                <dd>{new Date(module.modifiedTimeStamp).toLocaleString()}</dd>
              </div>
              {module.modifiedBy && (
                <div className="module-details__info-item">
                  <dt>Modified By</dt>
                  <dd>{module.modifiedBy}</dd>
                </div>
              )}
              {module.description && (
                <div className="module-details__info-item module-details__info-item--full">
                  <dt>Description</dt>
                  <dd>{module.description}</dd>
                </div>
              )}
              {sourceLink && (
                <div className="module-details__info-item module-details__info-item--full">
                  <dt>Source</dt>
                  <dd>
                    <a
                      href={sourceLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="module-details__source-link"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      {sourceLink.label}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>

        {/* Steps Section */}
        <Card className="module-details__steps-card">
          <CardHeader>
            <h3>Steps ({steps.length})</h3>
          </CardHeader>
          <CardBody>
            {loadingSteps ? (
              <Loading message="Loading steps..." />
            ) : (
              <DataTable
                columns={stepColumns}
                data={steps}
                keyField="id"
                onRowClick={onSelectStep}
                emptyMessage="No steps found in this module."
              />
            )}
          </CardBody>
        </Card>

        {/* Entries Section for Data type modules */}
        {moduleType === 'Data' && (
          <Card className="module-details__entries-card">
            <CardHeader>
              <h3>Entries {!loadingEntries && `(${entries.length})`}</h3>
            </CardHeader>
            <CardBody>
              {loadingEntries ? (
                <Loading message="Loading entries..." />
              ) : entriesError ? (
                <Alert variant="error" title="Failed to load entries">
                  {entriesError}
                </Alert>
              ) : entries.length === 0 ? (
                <p className="module-details__empty-message">No entries found.</p>
              ) : (
                <div className="module-details__entries-table-wrapper">
                  <table className="module-details__entries-table">
                    <thead>
                      <tr>
                        <th>Key</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry, index) => (
                        <tr key={index}>
                          <td>{entry.key}</td>
                          <td>{entry.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* Submodules Section */}
        {(submodules.length > 0 || loadingSubmodules) && (
          <Card className="module-details__submodules-card">
            <CardHeader>
              <h3>Submodules ({submodules.length})</h3>
            </CardHeader>
            <CardBody>
              {loadingSubmodules ? (
                <Loading message="Loading submodules..." />
              ) : (
                <DataTable
                  columns={submoduleColumns}
                  data={submodules}
                  keyField="id"
                  emptyMessage="No submodules found."
                />
              )}
            </CardBody>
          </Card>
        )}

        {/* Delete Module Section */}
        <Card className="module-details__danger-card">
          <CardHeader>
            <h3>Danger Zone</h3>
          </CardHeader>
          <CardBody>
            {deleteError && (
              <Alert variant="error" title="Delete Failed" dismissible onClose={() => setDeleteError(null)}>
                {deleteError}
              </Alert>
            )}
            {!showDeleteConfirm ? (
              <div className="module-details__danger-content">
                <div className="module-details__danger-info">
                  <p className="module-details__danger-title">Delete this module</p>
                  <p className="module-details__danger-description">
                    Once deleted, this module and all its steps will be permanently removed.
                  </p>
                </div>
                <Button variant="danger" onClick={handleDeleteClick}>
                  Delete Module
                </Button>
              </div>
            ) : (
              <div className="module-details__delete-confirm">
                <Alert variant="warning" title="Confirm Deletion">
                  Are you sure you want to delete <strong>{module.name}</strong>? This action cannot be undone.
                </Alert>
                <div className="module-details__delete-actions">
                  <Button variant="tertiary" onClick={handleDeleteCancel} disabled={deleting}>
                    Cancel
                  </Button>
                  <Button variant="danger" onClick={handleDeleteConfirm} loading={deleting}>
                    {deleting ? 'Deleting...' : 'Yes, Delete Module'}
                  </Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
};

export default ModuleDetails;
