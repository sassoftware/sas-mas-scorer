// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

/**
 * The rule every expected-versus-actual check in the scorer uses
 * (utils/expectedValues.ts), stated where the result is shown. The app only
 * compares values that MAS returned with values the user saved or mapped; it
 * does not know why a value differs.
 */
export const ComparisonRule: React.FC<{ className?: string }> = ({ className }) => (
  <details className={`comparison-rule${className ? ` ${className}` : ''}`}>
    <summary className="comparison-rule__summary">How values are compared</summary>
    <ul className="comparison-rule__list">
      <li>
        Actual values are what the published MAS module returned for this run; nothing is
        calculated in the browser.
      </li>
      <li>
        Numbers, also numbers written as text such as <code>&quot;12.50&quot;</code>, match when they
        differ by at most 1&nbsp;×&nbsp;10<sup>−9</sup> times the expected value (or by at most
        1&nbsp;×&nbsp;10<sup>−9</sup> when the expected value is between −1 and 1). No rounding
        or format is applied.
      </li>
      <li>
        Text matches exactly after leading and trailing blanks are removed; upper and lower case
        count. A date-time written with &ldquo;T&rdquo; or a blank, or with a zero fraction, is
        the same value.
      </li>
      <li>
        Missing values match each other: null, an empty value and the SAS missing values
        <code>.</code>, <code>.A</code>–<code>.Z</code> and <code>._</code>.
      </li>
      <li>
        An expected value that is null or blank is not checked (&ldquo;Not checked&rdquo;). To
        require a missing result, expect <code>.</code>.
      </li>
      <li>DataGrids and lists match when every cell matches by the same rules.</li>
      <li>
        &ldquo;Differs&rdquo; only says that the values are not the same; it does not say why.
      </li>
    </ul>
  </details>
);

export default ComparisonRule;
