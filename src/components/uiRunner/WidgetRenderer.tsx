// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIField } from '../../types/uiBuilder';
import { StepParameter } from '../../types';
import { TextWidget } from './widgets/TextWidget';
import { NumberWidget } from './widgets/NumberWidget';
import { SliderWidget } from './widgets/SliderWidget';
import { DropdownWidget } from './widgets/DropdownWidget';
import { RadioWidget } from './widgets/RadioWidget';
import { ToggleWidget } from './widgets/ToggleWidget';
import { TextareaWidget } from './widgets/TextareaWidget';
import { ReadonlyWidget } from './widgets/ReadonlyWidget';
import { GaugeWidget } from './widgets/GaugeWidget';
import { BadgeWidget } from './widgets/BadgeWidget';
import { MarkdownWidget } from './widgets/MarkdownWidget';
import { InputWidgetProps } from './widgets/types';

interface Props {
  field: UIField;
  value: unknown;
  onChange?: (value: unknown) => void;
  disabled?: boolean;
  parameter?: StepParameter;
  id?: string;
  labelId?: string;
  describedBy?: string;
  invalid?: boolean;
}

export const WidgetRenderer: React.FC<Props> = ({ field, value, onChange, ...rest }) => {
  const inputProps: InputWidgetProps = {
    field,
    value,
    onChange: onChange ?? (() => {}),
    ...rest,
  };

  switch (field.widget) {
    case 'text':
      return <TextWidget {...inputProps} />;
    case 'number':
      return <NumberWidget {...inputProps} />;
    case 'slider':
      return <SliderWidget {...inputProps} />;
    case 'dropdown':
      return <DropdownWidget {...inputProps} />;
    case 'radio':
      return <RadioWidget {...inputProps} />;
    case 'toggle':
      return <ToggleWidget {...inputProps} />;
    case 'textarea':
      return <TextareaWidget {...inputProps} />;
    case 'readonly':
      return <ReadonlyWidget field={field} value={value} />;
    case 'gauge':
      return <GaugeWidget field={field} value={value} />;
    case 'badge':
      return <BadgeWidget field={field} value={value} />;
    case 'markdown':
      return <MarkdownWidget content={String(field.defaultValue ?? '')} />;
    case 'hidden':
      return null;
    default:
      return <ReadonlyWidget field={field} value={value} />;
  }
};
