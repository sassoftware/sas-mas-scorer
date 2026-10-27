// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { StepParameter } from '../../../types';
import { UIField } from '../../../types/uiBuilder';

/** Props every input widget takes. */
export interface InputWidgetProps {
  field: UIField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  /** The step parameter the field is bound to; absent while the step loads. */
  parameter?: StepParameter;
  /** Id for the control, so the field's label points at it. */
  id?: string;
  /** Id of the visible field label, for controls a <label> cannot name. */
  labelId?: string;
  /** Ids of the hint and error text, for aria-describedby. */
  describedBy?: string;
  invalid?: boolean;
}

/** The shared ARIA attributes for a single input control. */
export function controlAria(props: InputWidgetProps) {
  return {
    id: props.id,
    'aria-invalid': props.invalid ? true : undefined,
    'aria-describedby': props.describedBy || undefined,
    'aria-required': props.field.validation?.required ? true : undefined,
  } as const;
}
