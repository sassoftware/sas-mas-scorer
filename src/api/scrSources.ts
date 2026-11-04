// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Which SAS content an SCR endpoint was likely published from.
 *
 * An endpoint does not say where it came from. Viya does keep a record of
 * every container publish (modelPublish, publishType 'container'), with the
 * name it was published as, the image it built (properties.imageUrl, when
 * the publish completed) and the exact source: a Model Manager model, a
 * decision flow revision or a rule set. The endpoint's name is matched
 * against those, then the candidate's signature is compared with the
 * endpoint's. The result says how strong the match is and why, never more:
 * a container can be built elsewhere, renamed when it is run, or come from a
 * revision whose signature has changed since.
 */

import { fetchAllPaginated } from './paginate';
import { cachedRequest, CACHE_FRESH_MS, CACHE_STALE_MS, type RequestOptions } from './requestCache';
import { getDecisionRevision } from './decisions';
import { getRuleSet } from './rulesets';
import { getSidModel } from './sidModels';
import { buildDeepLink } from '../utils/deepLinks';
import type { PublishedItem } from '../types/modelPublish';
import type { ScrEndpointInfo } from './scr';

export type ScrSourceKind = 'model' | 'decision' | 'ruleSet' | 'other';

/** How a candidate was found. */
export type ScrNameMatch =
  /** The image the publish built has the endpoint's name. */
  | 'image'
  /** The publish name equals the endpoint name (ignoring case). */
  | 'exact'
  /** Equal once case, '-', '_' and a trailing version like 1_0 are ignored. */
  | 'normalized';

export type ScrConfidence = 'matched' | 'likely' | 'weak';

export interface ScrSignatureComparison {
  /** Endpoint inputs the source also has / all endpoint inputs. */
  inputsShared: number;
  inputsTotal: number;
  outputsShared: number;
  outputsTotal: number;
  /** Source inputs the endpoint does not have. */
  sourceOnlyInputs: string[];
  /** Endpoint inputs the source does not have. */
  endpointOnlyInputs: string[];
}

export interface ScrSourceCandidate {
  kind: ScrSourceKind;
  sourceUri: string;
  /** Name of the model / flow / rule set (from the record or the source). */
  sourceName: string;
  publishName: string;
  imageUrl?: string;
  projectName?: string;
  codeType?: string;
  state: string;
  publishedAt: string;
  publishedBy?: string;
  destinationName: string;
  nameMatch: ScrNameMatch;
  confidence: ScrConfidence;
  /** Plain-language reasons for the confidence, in order. */
  reasons: string[];
  signature?: ScrSignatureComparison;
  /** The source could not be read (deleted, no access). */
  sourceError?: string;
}

const CONTAINER_RECORDS_KEY = 'scrContainerPublishRecords';

/** Every container publish record, newest first. Cached like the other publish lookups. */
export function getContainerPublishRecords(options?: RequestOptions): Promise<PublishedItem[]> {
  return cachedRequest(
    CONTAINER_RECORDS_KEY,
    () =>
      fetchAllPaginated<PublishedItem>('/modelPublish/models', {
        params: { filter: "eq(publishType,'container')", sortBy: 'creationTimeStamp:descending' },
        pageSize: 500,
      }),
    { freshMs: CACHE_FRESH_MS, staleMs: CACHE_STALE_MS },
    options
  );
}

export const sourceKind = (uri: string): ScrSourceKind => {
  if (uri.startsWith('/modelRepository/models/')) return 'model';
  if (uri.startsWith('/decisions/flows/')) return 'decision';
  if (uri.startsWith('/businessRules/ruleSets/')) return 'ruleSet';
  return 'other';
};

const normalize = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Decisions are published as e.g. name1_0: drop a trailing major_minor version. */
const withoutVersion = (name: string): string => name.replace(/[-_]?\d+_\d+$/, '');

/** The repository part of an image URL: registry/library/name:tag → name. */
export const imageRepositoryName = (imageUrl: string): string => {
  const noTag = imageUrl.replace(/@sha256:.*$/, '').replace(/:[^/:]+$/, '');
  return noTag.slice(noTag.lastIndexOf('/') + 1);
};

type RecordProps = { imageUrl?: string; projectName?: string; modelName?: string };
const props = (record: PublishedItem): RecordProps => (record.properties ?? {}) as RecordProps;

export function nameMatch(endpointName: string, record: PublishedItem): ScrNameMatch | null {
  const imageUrl = props(record).imageUrl;
  if (imageUrl && imageRepositoryName(imageUrl).toLowerCase() === endpointName.toLowerCase()) return 'image';
  if (record.publishName && record.publishName.toLowerCase() === endpointName.toLowerCase()) return 'exact';
  if (!record.publishName) return null;
  const a = normalize(withoutVersion(endpointName));
  const b = normalize(withoutVersion(record.publishName));
  return a && a === b ? 'normalized' : null;
}

/**
 * Candidates by name only, one per source (its newest record, preferring a
 * completed one). Pure, for testing.
 */
export function findNameCandidates(endpointName: string, records: PublishedItem[]): Array<{ record: PublishedItem; match: ScrNameMatch }> {
  const rank: Record<ScrNameMatch, number> = { image: 0, exact: 1, normalized: 2 };
  const bySource = new Map<string, { record: PublishedItem; match: ScrNameMatch }>();
  for (const record of records) {
    if (!record.sourceUri) continue;
    const match = nameMatch(endpointName, record);
    if (!match) continue;
    const key = record.sourceUri.replace(/\/revisions\/.*$/, '');
    const current = bySource.get(key);
    const better =
      !current ||
      rank[match] < rank[current.match] ||
      (rank[match] === rank[current.match] &&
        ((record.state === 'completed' && current.record.state !== 'completed') ||
          (record.state === current.record.state &&
            (Date.parse(record.creationTimeStamp) || 0) > (Date.parse(current.record.creationTimeStamp) || 0))));
    if (better) bySource.set(key, { record, match });
  }
  return [...bySource.values()].sort((x, y) => rank[x.match] - rank[y.match]);
}

interface SourceSignature {
  name?: string;
  inputs: string[];
  outputs: string[];
}

async function readSourceSignature(record: PublishedItem): Promise<SourceSignature | null> {
  const uri = record.sourceUri;
  const kind = sourceKind(uri);
  if (kind === 'decision') {
    const flow = await getDecisionRevision(uri);
    const sig = flow.signature ?? [];
    return {
      name: flow.name,
      inputs: sig.filter((v) => v.direction === 'input' || v.direction === 'inOut').map((v) => v.name),
      outputs: sig.filter((v) => v.direction === 'output' || v.direction === 'inOut').map((v) => v.name),
    };
  }
  if (kind === 'ruleSet') {
    const id = uri.match(/^\/businessRules\/ruleSets\/([^/]+)/)?.[1];
    if (!id) return null;
    const ruleSet = await getRuleSet(id);
    const sig = ruleSet.signature ?? [];
    return {
      name: ruleSet.name,
      inputs: sig.filter((v) => v.direction === 'input' || v.direction === 'inOut').map((v) => v.name),
      outputs: sig.filter((v) => v.direction === 'output' || v.direction === 'inOut').map((v) => v.name),
    };
  }
  if (kind === 'model') {
    const id = uri.match(/^\/modelRepository\/models\/([^/]+)/)?.[1];
    if (!id) return null;
    const model = await getSidModel(id);
    if (!model.inputVariables && !model.outputVariables) return { name: model.name, inputs: [], outputs: [] };
    return {
      name: model.name,
      inputs: (model.inputVariables ?? []).map((v) => v.name),
      outputs: (model.outputVariables ?? []).map((v) => v.name),
    };
  }
  return null;
}

export function compareSignatures(info: ScrEndpointInfo, source: SourceSignature): ScrSignatureComparison {
  const lower = (names: string[]) => new Set(names.map((n) => n.toLowerCase()));
  const srcIn = lower(source.inputs);
  const srcOut = lower(source.outputs);
  const epIn = lower(info.inputs.map((v) => v.name));
  return {
    inputsShared: info.inputs.filter((v) => srcIn.has(v.name.toLowerCase())).length,
    inputsTotal: info.inputs.length,
    outputsShared: info.outputs.filter((v) => srcOut.has(v.name.toLowerCase())).length,
    outputsTotal: info.outputs.length,
    sourceOnlyInputs: source.inputs.filter((n) => !epIn.has(n.toLowerCase())),
    endpointOnlyInputs: info.inputs.filter((v) => !srcIn.has(v.name.toLowerCase())).map((v) => v.name),
  };
}

const MATCH_REASON: Record<ScrNameMatch, string> = {
  image: 'The publish built an image with this endpoint’s name',
  exact: 'The publish name equals the endpoint name',
  normalized: 'The publish name matches the endpoint name once case, separators and a version suffix are ignored',
};

/** Confidence and reasons from the name match and the signature comparison. Pure. */
export function judge(
  match: ScrNameMatch,
  state: string,
  comparison: ScrSignatureComparison | undefined,
  sourceError?: string
): { confidence: ScrConfidence; reasons: string[] } {
  const reasons = [MATCH_REASON[match]];
  if (state !== 'completed') reasons.push(`Its publish record says the publish ${state === 'failed' ? 'failed' : `is ${state || 'not completed'}`}`);
  if (sourceError) {
    reasons.push(`The source could not be read: ${sourceError}`);
    return { confidence: match === 'normalized' ? 'weak' : 'likely', reasons };
  }
  if (!comparison || (comparison.inputsTotal === 0 && comparison.outputsTotal === 0)) {
    reasons.push('No signature to compare');
    return { confidence: match === 'normalized' ? 'weak' : 'likely', reasons };
  }
  const inputsAgree =
    comparison.inputsShared === comparison.inputsTotal && comparison.sourceOnlyInputs.length === 0;
  const outputsAgree = comparison.outputsShared === comparison.outputsTotal;
  if (inputsAgree && outputsAgree) {
    reasons.push(
      `Same inputs (${comparison.inputsTotal}) and outputs (${comparison.outputsTotal}) as the current source`
    );
    return { confidence: match === 'normalized' ? 'likely' : 'matched', reasons };
  }
  reasons.push(
    `Signature differs from the current source: ${comparison.inputsShared} of ${comparison.inputsTotal} inputs and ` +
      `${comparison.outputsShared} of ${comparison.outputsTotal} outputs shared` +
      ' (the source may have changed since this image was built)'
  );
  return { confidence: comparison.inputsShared > 0 ? 'likely' : 'weak', reasons };
}

/** Ranked candidates for an endpoint, with their signatures checked (at most 5 sources read). */
export async function findScrSources(info: ScrEndpointInfo, options?: RequestOptions): Promise<ScrSourceCandidate[]> {
  const records = await getContainerPublishRecords(options);
  const candidates = findNameCandidates(info.name, records).slice(0, 5);
  const order: Record<ScrConfidence, number> = { matched: 0, likely: 1, weak: 2 };
  const results = await Promise.all(
    candidates.map(async ({ record, match }): Promise<ScrSourceCandidate> => {
      let comparison: ScrSignatureComparison | undefined;
      let sourceError: string | undefined;
      let sourceName = props(record).modelName || record.name || record.publishName;
      try {
        const signature = await readSourceSignature(record);
        if (signature) {
          comparison = compareSignatures(info, signature);
          if (signature.name) sourceName = signature.name;
        }
      } catch (err) {
        sourceError = err instanceof Error ? err.message : String(err);
      }
      const { confidence, reasons } = judge(match, record.state, comparison, sourceError);
      return {
        kind: sourceKind(record.sourceUri),
        sourceUri: record.sourceUri,
        sourceName,
        publishName: record.publishName,
        imageUrl: props(record).imageUrl,
        projectName: props(record).projectName,
        codeType: record.codeType,
        state: record.state,
        publishedAt: record.creationTimeStamp,
        publishedBy: record.createdBy,
        destinationName: record.destinationName,
        nameMatch: match,
        confidence,
        reasons,
        signature: comparison,
        sourceError,
      };
    })
  );
  return results.sort((a, b) => order[a.confidence] - order[b.confidence]);
}

/** Open-in-SAS link for a source (Model Manager or Intelligent Decisioning). */
export function sourceDeepLink(candidate: ScrSourceCandidate): { url: string; label: string } | null {
  const type = { model: 'model', decision: 'decision', ruleSet: 'ruleset', other: '' }[candidate.kind];
  return type ? buildDeepLink(type, candidate.sourceUri) : null;
}
