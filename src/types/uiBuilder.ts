// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// UI Builder type definitions

export interface UIDefinition {
  id: string;
  name: string;
  description?: string;
  moduleId: string;
  stepId: string;
  createdAt: string;
  updatedAt: string;
  layout: UILayout;
  settings: UISettings;
}

export interface UIDefinitionSummary {
  id: string;
  name: string;
  description?: string;
  moduleId: string;
  stepId: string;
  createdAt: string;
  updatedAt: string;
}

export interface UILayout {
  columns: 1 | 2 | 3;
  sections: UISection[];
}

export interface UISection {
  id: string;
  title?: string;
  collapsed?: boolean;
  fields: UIField[];
}

export interface UIField {
  parameterId: string;
  direction: 'input' | 'output' | 'static';
  label: string;
  description?: string;
  widget: WidgetType;
  visible: boolean;
  order: number;
  defaultValue?: unknown;
  placeholder?: string;
  width: 'full' | 'half' | 'third';
  validation?: FieldValidation;
}

export type WidgetType =
  | 'text'
  | 'number'
  | 'slider'
  | 'dropdown'
  | 'radio'
  | 'toggle'
  | 'textarea'
  | 'readonly'
  | 'gauge'
  | 'badge'
  | 'hidden'
  | 'markdown';

export interface FieldValidation {
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  options?: FieldOption[];
  valueMappings?: ValueMapping[];
  gaugeConfig?: GaugeConfig;
}

export interface FieldOption {
  label: string;
  value: unknown;
}

export interface ValueMapping {
  from: string;
  to: string;
}

export interface GaugeConfig {
  min: number;
  max: number;
  colorStops: GaugeColorStop[];
}

export interface GaugeColorStop {
  upTo: number;
  color: string;
}

export interface UISettings {
  title?: string;
  submitLabel?: string;
  showExecutionTime?: boolean;
  theme?: 'default' | 'compact' | 'card';
  outputLayout?: 'inline' | 'below' | 'side-by-side';
}
