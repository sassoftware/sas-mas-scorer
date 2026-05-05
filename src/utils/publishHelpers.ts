// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  PublishDestination,
  PublishedItem,
  PublishedKind,
} from '../types/modelPublish';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getPublishedKind = (sourceUri: string | undefined | null): PublishedKind => {
  if (!sourceUri) return 'unknown';
  if (sourceUri.startsWith('/modelRepository/models/')) return 'model';
  if (sourceUri.startsWith('/analyticsComponents/components/')) return 'model';
  if (sourceUri.startsWith('/decisions/flows/')) return 'decision';
  if (sourceUri.startsWith('/referenceData/domains/')) return 'decision';
  return 'unknown';
};

export const extractDecisionFlowId = (sourceUri: string | undefined | null): string | null => {
  if (!sourceUri) return null;
  const match = sourceUri.match(/^\/decisions\/flows\/([0-9a-f-]+)/i);
  if (!match) return null;
  const id = match[1];
  return UUID_RE.test(id) ? id : null;
};

export const dedupPublishedItems = (items: PublishedItem[]): PublishedItem[] => {
  const map = new Map<string, PublishedItem>();
  for (const item of items) {
    const key = `${item.destinationName}::${item.publishName}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }
    const existingTs = Date.parse(existing.creationTimeStamp) || 0;
    const currentTs = Date.parse(item.creationTimeStamp) || 0;
    if (currentTs > existingTs) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
};

export interface DestinationDetailField {
  label: string;
  value: string;
}

const getProperty = (d: PublishDestination, name: string): string | undefined => {
  const p = d.properties?.find((x) => x.name === name);
  return p?.value;
};

export const getDestinationDetailFields = (d: PublishDestination): DestinationDetailField[] => {
  const fields: DestinationDetailField[] = [];

  switch (d.destinationType) {
    case 'cas':
      if (d.casServerName) fields.push({ label: 'CAS Server', value: d.casServerName });
      if (d.casLibrary) fields.push({ label: 'CAS Library', value: d.casLibrary });
      if (d.destinationTable) fields.push({ label: 'Table', value: d.destinationTable });
      break;

    case 'singleStore':
      if (d.databaseHost) fields.push({ label: 'Host', value: d.databaseHost });
      if (d.databasePort !== undefined) fields.push({ label: 'Port', value: String(d.databasePort) });
      if (d.databaseSchema) fields.push({ label: 'Schema', value: d.databaseSchema });
      {
        const cred = getProperty(d, 'credDomainId');
        if (cred) fields.push({ label: 'Credential Domain', value: cred });
      }
      break;

    case 'git': {
      const repo = getProperty(d, 'remoteRepositoryURL');
      const branch = getProperty(d, 'gitBranch');
      const folder = getProperty(d, 'deploymentGitFolder');
      const codeGen = getProperty(d, 'codeGenerationMode');
      const userName = getProperty(d, 'userName');
      const userEmail = getProperty(d, 'userEmail');
      const cred = getProperty(d, 'credDomainId');
      if (repo) fields.push({ label: 'Repository URL', value: repo });
      if (branch) fields.push({ label: 'Branch', value: branch });
      if (folder) fields.push({ label: 'Deployment Folder', value: folder });
      if (codeGen) fields.push({ label: 'Code Generation Mode', value: codeGen });
      if (userName) fields.push({ label: 'User Name', value: userName });
      if (userEmail) fields.push({ label: 'User Email', value: userEmail });
      if (cred) fields.push({ label: 'Credential Domain', value: cred });
      break;
    }

    case 'privateDocker': {
      const baseRepo = getProperty(d, 'baseRepoUrl');
      const kube = getProperty(d, 'kubeUrl');
      const authUrl = getProperty(d, 'dockerRegistryAuthURL');
      const ns = getProperty(d, 'validationNamespace');
      const cred = getProperty(d, 'credDomainId');
      const ssl = getProperty(d, 'sslSecretName');
      if (baseRepo) fields.push({ label: 'Base Repo URL', value: baseRepo });
      if (kube) fields.push({ label: 'Kubernetes URL', value: kube });
      if (authUrl) fields.push({ label: 'Registry Auth URL', value: authUrl });
      if (ns) fields.push({ label: 'Validation Namespace', value: ns });
      if (cred) fields.push({ label: 'Credential Domain', value: cred });
      if (ssl) fields.push({ label: 'SSL Secret', value: ssl });
      break;
    }

    case 'esp': {
      const target = getProperty(d, 'targetContainerName');
      if (target) fields.push({ label: 'Target Container', value: target });
      break;
    }

    case 'microAnalyticService':
      // No type-specific fields beyond description.
      break;

    default:
      // Fallback — surface any properties the server returned.
      for (const p of d.properties ?? []) {
        if (p.value) fields.push({ label: p.name, value: p.value });
      }
      break;
  }

  return fields;
};

export const formatDestinationTypeLabel = (destinationType: string): string => {
  switch (destinationType) {
    case 'microAnalyticService':
      return 'MAS';
    case 'cas':
      return 'CAS';
    case 'singleStore':
      return 'SingleStore';
    case 'privateDocker':
      return 'Private Docker';
    case 'esp':
      return 'ESP';
    case 'git':
      return 'Git';
    case 'aws':
      return 'AWS';
    case 'azure':
      return 'Azure';
    case 'gcp':
      return 'GCP';
    case 'aml':
      return 'AML';
    case 'hadoop':
      return 'Hadoop';
    case 'teradata':
      return 'Teradata';
    default:
      return destinationType;
  }
};
