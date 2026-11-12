// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Download progress of a pull: a bar, the bytes received of the bytes to
 * download, the current rate and the time left. The engine reports no byte
 * counts itself; the main process puts them together (see
 * electron/containers/download.ts), and the note under the bar says how.
 */

import React from 'react';
import type { PullDownload } from '../../types/localContainers';

/** Decimal units, as registries and download rates use them. */
export function formatDownloadBytes(n: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${i === 0 ? Math.round(v) : v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function formatTimeLeft(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(1, Math.round(seconds / 5) * 5)} s left`;
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} min left`;
  return `about ${(seconds / 3600).toFixed(1)} h left`;
}

const SOURCE_NOTE: Record<PullDownload['source'], string> = {
  'machine-network':
    "Measured on the Podman machine's network connection, so other downloads there count too. The size comes from the registry, less the layers the engine already has.",
  'host-network':
    "Measured on this computer's network connection, so other downloads count too. The size comes from the registry, less the layers the engine already has.",
  layers:
    'Docker Desktop reports finished layers only, so the bar moves one layer at a time and there is no live rate. The size comes from the registry.',
};

export const PullProgress: React.FC<{ download: PullDownload }> = ({ download }) => {
  const { totalBytes, receivedBytes, rateBps, totalIsUpperBound } = download;
  const hasTotal = totalBytes !== undefined && totalBytes > 0;
  const received = receivedBytes ?? 0;
  const fraction = totalBytes === 0 ? 1 : hasTotal ? Math.min(1, received / (totalBytes as number)) : null;

  const parts: string[] = [];
  if (totalBytes === 0) {
    parts.push('The engine already has every layer');
  } else if (hasTotal && fraction === 1) {
    // The engine still writes the last layers to disk after the last byte arrived.
    parts.push(`${formatDownloadBytes(totalBytes as number)} downloaded`, 'storing the image');
  } else {
    if (hasTotal) {
      parts.push(`${formatDownloadBytes(received)} of ${totalIsUpperBound ? 'up to ' : ''}${formatDownloadBytes(totalBytes as number)}`);
    } else if (received > 0) {
      parts.push(`${formatDownloadBytes(received)} received`);
    } else {
      parts.push('Waiting for the first bytes');
    }
    if (rateBps !== undefined && received > 0) parts.push(`${formatDownloadBytes(rateBps)}/s`);
    // No time left from the first trickle of the handshake.
    if (hasTotal && !totalIsUpperBound && rateBps !== undefined && rateBps >= 100_000 && received >= 1_000_000) {
      parts.push(formatTimeLeft(((totalBytes as number) - received) / rateBps));
    }
  }
  const text = parts.join(' · ');

  return (
    <div className="lc-pull">
      <div
        className={`lc-pullbar${fraction === null ? ' lc-pullbar--indeterminate' : ''}`}
        role="progressbar"
        aria-label="Download"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
        aria-valuetext={text || 'Downloading'}
      >
        <div className="lc-pullbar__fill" style={fraction === null ? undefined : { width: `${(fraction * 100).toFixed(1)}%` }} />
      </div>
      {text && <div className="lc-pull__text">{text}</div>}
      <div className="lc-pull__note">{SOURCE_NOTE[download.source]}</div>
    </div>
  );
};

export default PullProgress;
