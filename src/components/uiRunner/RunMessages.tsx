// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { MessageRule } from '../../types/uiBuilder';
import { matchingMessages } from '../../utils/messageRules';

const ICONS: Record<MessageRule['tone'], React.ReactNode> = {
  info: <path d="M12 8h.01M11 12h1v5h1" />,
  success: <path d="M7.5 12.5l3 3 6-6" />,
  warning: <path d="M12 8v5M12 16.5h.01" />,
  error: <path d="M9 9l6 6M15 9l-6 6" />,
};

const TONE_WORD: Record<MessageRule['tone'], string> = {
  info: 'Information',
  success: 'Success',
  warning: 'Warning',
  error: 'Problem',
};

/**
 * The app author's messages whose condition the last run's results meet, in
 * their order. Each has an icon and a spoken tone word, not colour alone.
 */
export const RunMessages: React.FC<{ rules?: MessageRule[]; outputs: Record<string, unknown> }> = ({ rules, outputs }) => {
  const hits = matchingMessages(rules, outputs);
  if (hits.length === 0) return null;
  return (
    <div className="ui-runner__messages" role="status">
      {hits.map(r => (
        <div key={r.id} className={`ui-runner__message ui-runner__message--${r.tone}`}>
          <svg className="ui-runner__message-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9.5" />
            {ICONS[r.tone]}
          </svg>
          <span className="sr-only">{TONE_WORD[r.tone]}: </span>
          <span>{r.message}</span>
        </div>
      ))}
    </div>
  );
};
