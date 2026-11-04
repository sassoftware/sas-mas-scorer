// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardBody, CardHeader } from '../common/Card';
import { Button } from '../common/Button';
import { Badge, type BadgeVariant } from '../common/Badge';
import { Loading } from '../common/Loading';
import { useSasAuth } from '../../auth';
import type { ScrEndpointInfo } from '../../api/scr';
import {
  findScrSources,
  sourceDeepLink,
  type ScrConfidence,
  type ScrSourceCandidate,
  type ScrSourceKind,
} from '../../api/scrSources';

const CONFIDENCE: Record<ScrConfidence, { label: string; variant: BadgeVariant }> = {
  matched: { label: 'Matched', variant: 'success' },
  likely: { label: 'Likely', variant: 'info' },
  weak: { label: 'Weak', variant: 'warning' },
};

const KIND_LABEL: Record<ScrSourceKind, string> = {
  model: 'Model Manager model',
  decision: 'Decision flow',
  ruleSet: 'Rule set',
  other: 'Other content',
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

export const ScrSourcePanel: React.FC<{ info: ScrEndpointInfo }> = ({ info }) => {
  const { isAuthenticated } = useSasAuth();
  const [candidates, setCandidates] = useState<ScrSourceCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        setCandidates(await findScrSources(info, { refresh }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [info]
  );

  useEffect(() => {
    if (isAuthenticated) load();
  }, [isAuthenticated, load]);

  return (
    <Card>
      <CardHeader
        actions={
          isAuthenticated && (
            <Button size="small" variant="secondary" onClick={() => load(true)} disabled={loading}>
              Search again
            </Button>
          )
        }
      >
        Likely source in SAS Viya
      </CardHeader>
      <CardBody>
        {!isAuthenticated ? (
          <p className="scr-muted">Sign in to SAS Viya to look up which model or decision this container was published from.</p>
        ) : loading && !candidates ? (
          <Loading message="Searching container publish records..." />
        ) : error ? (
          <p className="scr-muted">The publish records could not be read: {error}</p>
        ) : candidates && candidates.length === 0 ? (
          <p className="scr-muted">
            No container publish of “{info.name}” in this SAS Viya. The image may have been built from another
            environment, published under another name, or renamed when it was deployed.
          </p>
        ) : (
          <ul className="scr-sources">
            {candidates?.map((c) => {
              const link = sourceDeepLink(c);
              return (
                <li key={c.sourceUri} className="scr-source">
                  <div className="scr-source__head">
                    <Badge variant={CONFIDENCE[c.confidence].variant} size="small">
                      {CONFIDENCE[c.confidence].label}
                    </Badge>
                    <strong className="scr-source__name">{c.sourceName}</strong>
                    <span className="scr-muted">{KIND_LABEL[c.kind]}</span>
                    {link && (
                      <a className="scr-link" href={link.url} target="_blank" rel="noreferrer">
                        {link.label}
                      </a>
                    )}
                  </div>
                  <ul className="scr-source__reasons">
                    {c.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <p className="scr-source__meta">
                    Published as <code>{c.publishName}</code> to {c.destinationName} on {formatDate(c.publishedAt)}
                    {c.publishedBy ? ` by ${c.publishedBy}` : ''}
                    {c.imageUrl && (
                      <>
                        {' '}· image <code>{c.imageUrl}</code>
                      </>
                    )}
                    {c.projectName && <> · project {c.projectName}</>}
                  </p>
                  {c.signature && (c.signature.endpointOnlyInputs.length > 0 || c.signature.sourceOnlyInputs.length > 0) && (
                    <p className="scr-source__meta">
                      {c.signature.endpointOnlyInputs.length > 0 && (
                        <>Only in the endpoint: {c.signature.endpointOnlyInputs.join(', ')}. </>
                      )}
                      {c.signature.sourceOnlyInputs.length > 0 && (
                        <>Only in the source: {c.signature.sourceOnlyInputs.join(', ')}.</>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
};
