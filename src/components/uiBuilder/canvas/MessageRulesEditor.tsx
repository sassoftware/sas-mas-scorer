// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { MessageRule } from '../../../types/uiBuilder';
import { StepParameter } from '../../../types';
import { RULE_OPS } from '../../../utils/messageRules';
import { Button } from '../../common/Button';

interface Props {
  rules: MessageRule[];
  outputs: StepParameter[];
  onChange: (rules: MessageRule[]) => void;
}

const newId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** The app settings' "Messages after a run": when a result meets a condition, show the author's text. */
export const MessageRulesEditor: React.FC<Props> = ({ rules, outputs, onChange }) => {
  const update = (i: number, patch: Partial<MessageRule>) =>
    onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="cb-rules">
      {rules.map((r, i) => (
        <fieldset key={r.id} className="cb-rules__rule">
          <legend>Message {i + 1}</legend>
          <div className="cb-rules__row">
            <label>
              <span>When</span>
              <select className="sas-input" value={r.result} onChange={(e) => update(i, { result: e.target.value })}>
                {!r.result && <option value="">Choose a result</option>}
                {outputs.map(o => <option key={o.name} value={o.name}>{o.name}</option>)}
                {r.result && !outputs.some(o => o.name === r.result) && <option value={r.result}>{r.result} (not in the signature)</option>}
              </select>
            </label>
            <label>
              <span>Condition</span>
              <select className="sas-input" value={r.op} onChange={(e) => update(i, { op: e.target.value as MessageRule['op'] })}>
                {RULE_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
          {r.op !== 'missing' && (
            <div className="cb-rules__row">
              <label>
                <span>{r.op === 'between' ? 'From' : 'Value'}</span>
                <input className="sas-input" value={r.value ?? ''} onChange={(e) => update(i, { value: e.target.value })} />
              </label>
              {r.op === 'between' && (
                <label>
                  <span>To</span>
                  <input className="sas-input" value={r.value2 ?? ''} onChange={(e) => update(i, { value2: e.target.value })} />
                </label>
              )}
            </div>
          )}
          <label className="cb-rules__wide">
            <span>Show this message</span>
            <textarea className="sas-input" rows={2} value={r.message} onChange={(e) => update(i, { message: e.target.value })} />
          </label>
          <div className="cb-rules__row cb-rules__row--end">
            <label>
              <span>Kind</span>
              <select className="sas-input" value={r.tone} onChange={(e) => update(i, { tone: e.target.value as MessageRule['tone'] })}>
                <option value="info">Information</option>
                <option value="success">Success</option>
                <option value="warning">Warning</option>
                <option value="error">Problem</option>
              </select>
            </label>
            <Button variant="tertiary" size="small" onClick={() => onChange(rules.filter((_r, j) => j !== i))}>
              Remove message {i + 1}
            </Button>
          </div>
        </fieldset>
      ))}
      <Button
        variant="secondary"
        size="small"
        disabled={outputs.length === 0}
        onClick={() => onChange([...rules, { id: newId(), result: outputs[0]?.name ?? '', op: 'gt', value: '', message: '', tone: 'info' }])}
      >
        Add message
      </Button>
    </div>
  );
};
