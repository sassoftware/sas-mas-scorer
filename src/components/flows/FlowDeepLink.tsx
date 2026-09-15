// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

interface DeepLinkProps {
  url: string;
  label: string;
  /** Render `label` as visible text beside the icon (default: icon only). */
  showLabel?: boolean;
}

/**
 * The shared icon-only deep link (.sas-deep-link, components.css): a 32px
 * pointer target whose accessible name is `label`, the same affordance
 * Coverage and Publishing use for "open this asset in SAS".
 *
 * `showLabel` opts into the labelled variant (.flow-deep-link--labelled,
 * flows.css) for the one place — the decision detail header — where the link
 * is the only "open this in SAS Intelligent Decisioning" affordance on the
 * page and an unlabelled icon would be hard to find.
 */
export default function DeepLink({ url, label, showLabel = false }: DeepLinkProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`sas-deep-link${showLabel ? ' flow-deep-link--labelled' : ''}`}
      title={label}
      // With visible text the text itself is the accessible name; without it
      // the aria-label is the only one.
      aria-label={showLabel ? undefined : label}
    >
      <svg className="sas-deep-link__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
      {showLabel && <span>{label}</span>}
    </a>
  );
}
