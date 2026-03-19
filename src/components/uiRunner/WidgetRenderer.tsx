// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIField } from '../../types/uiBuilder';
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

interface Props {
  field: UIField;
  value: unknown;
  onChange?: (value: unknown) => void;
  disabled?: boolean;
}

export const WidgetRenderer: React.FC<Props> = ({ field, value, onChange, disabled }) => {
  const handleChange = onChange ?? (() => {});

  switch (field.widget) {
    case 'text':
      return <TextWidget field={field} value={value} onChange={handleChange} disabled={disabled} />;
    case 'number':
      return <NumberWidget field={field} value={value} onChange={handleChange} disabled={disabled} />;
    case 'slider':
      return <SliderWidget field={field} value={value} onChange={handleChange} disabled={disabled} />;
    case 'dropdown':
      return <DropdownWidget field={field} value={value} onChange={handleChange} disabled={disabled} />;
    case 'radio':
      return <RadioWidget field={field} value={value} onChange={handleChange} disabled={disabled} />;
    case 'toggle':
      return <ToggleWidget field={field} value={value} onChange={handleChange} disabled={disabled} />;
    case 'textarea':
      return <TextareaWidget field={field} value={value} onChange={handleChange} disabled={disabled} />;
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
