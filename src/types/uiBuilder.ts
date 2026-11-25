// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// UI Builder type definitions

export interface UIDefinition {
  id: string;
  name: string;
  description?: string;
  moduleId: string;
  stepId: string;
  /**
   * Set when the app scores a SAS Container Runtime endpoint instead of a MAS
   * module: the endpoint's score URL. moduleId then holds the endpoint's name
   * and stepId its step id. Unset means MAS (every definition before 2.13).
   */
  scrUrl?: string;
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
  scrUrl?: string;
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
  /** A colour line beside the section (3.1), as #rrggbb. */
  color?: string;
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
  | 'markdown'
  /** An output shown as a table: a decision DataGrid, or an array as one column (3.1). */
  | 'table'
  /** A SAS date (days since 1960-01-01) as a date picker or a readable date (3.1). */
  | 'date'
  /** A SAS datetime (seconds since 1960-01-01 00:00) as a date and time (3.1). */
  | 'datetime'
  /** On/off as a checkbox (3.1): sends the on/off values like Toggle; a result shows Yes or No. */
  | 'checkbox'
  /** A file picked or dropped, sent base64-encoded as a string input (3.1). */
  | 'file'
  /** A number as a percentage (3.1): entered or shown with %, sent as a fraction or as points. */
  | 'percent'
  /** A number as an amount of money (3.1): entered or shown with the currency symbol. */
  | 'currency';

/**
 * Per-field settings. Every member is optional: definitions saved by older
 * versions (in localStorage, exported JSON and share links) carry only some of
 * them, and a missing member always means the pre-2.12 behaviour.
 */
export interface FieldValidation {
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  options?: FieldOption[];
  valueMappings?: ValueMapping[];
  gaugeConfig?: GaugeConfig;
  /** Input must have a value before the app runs (default false). */
  required?: boolean;
  /** Longest accepted text; unset falls back to the parameter's MAS size. */
  maxLength?: number;
  /** Value a Toggle sends when on (default 1, or "Y" for a string parameter). */
  onValue?: string;
  /** Value a Toggle sends when off (default 0, or "N" for a string parameter). */
  offValue?: string;
  /** File upload (3.1): the file types offered, as an input accept list ("image/*", ".pdf"). */
  fileAccept?: string;
  /** File upload (3.1): plain base64 (default) or a data URL with its "data:…;base64," prefix. */
  fileFormat?: 'base64' | 'dataUrl';
  /** Percent (3.1): 'fraction' (default) sends 12.5 % as 0.125; 'points' sends 12.5. */
  percentScale?: 'fraction' | 'points';
  /** Currency (3.1): an ISO 4217 code such as EUR or USD (default EUR). */
  currency?: string;
}

/** A field's runtime problem, shown inline under the control. */
export type FieldErrors = Record<string, string>;

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
  /**
   * Where the run button sits (3.1). Unset means 'bottom', where apps saved
   * before 3.1 have always shown it; new apps start with 'afterInputs'.
   */
  submitPosition?: SubmitPosition;
  /** The run button's colour (3.1), as #rrggbb; unset is the standard blue. */
  accentColor?: string;
}

export type SubmitPosition = 'top' | 'afterInputs' | 'bottom';
