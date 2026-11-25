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
import { TableWidget } from './widgets/TableWidget';
import { DateInputWidget, DateOutputWidget } from './widgets/DateWidget';
import { CheckboxInputWidget, CheckboxOutputWidget } from './widgets/CheckboxWidget';
import { FileInputWidget } from './widgets/FileWidget';
import { KpiWidget } from './widgets/KpiWidget';
import { BarChartWidget } from './widgets/BarChartWidget';
import { ImageWidget } from './widgets/ImageWidget';
import { PercentCurrencyInputWidget, PercentCurrencyOutputWidget } from './widgets/PercentCurrencyWidget';
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
    case 'table':
      return <TableWidget field={field} value={value} labelId={rest.labelId} />;
    case 'date':
    case 'datetime':
      return field.direction === 'input'
        ? <DateInputWidget {...inputProps} />
        : <DateOutputWidget field={field} value={value} />;
    case 'checkbox':
      return field.direction === 'input'
        ? <CheckboxInputWidget {...inputProps} />
        : <CheckboxOutputWidget field={field} value={value} type={rest.parameter?.type} />;
    case 'percent':
    case 'currency':
      return field.direction === 'input'
        ? <PercentCurrencyInputWidget {...inputProps} />
        : <PercentCurrencyOutputWidget field={field} value={value} />;
    case 'image':
      return <ImageWidget field={field} value={value} />;
    case 'barchart':
      return <BarChartWidget field={field} value={value} labelId={rest.labelId} />;
    case 'kpi':
      return <KpiWidget field={field} value={value} />;
    case 'file':
      return <FileInputWidget {...inputProps} />;
    case 'hidden':
      return null;
    default:
      return <ReadonlyWidget field={field} value={value} />;
  }
};
