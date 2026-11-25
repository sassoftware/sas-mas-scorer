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
  /** How the runner shows the sections (3.1): one page (default), tabs, or steps with Back / Next. */
  display?: 'page' | 'tabs' | 'steps';
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
  /**
   * Show the field only when another field meets a condition (3.1). An input
   * hidden this way sends its default value, or missing without one.
   */
  showWhen?: {
    /** The other field's parameterId (an input; or, for results and text, a result too). */
    field: string;
    op: 'eq' | 'ne' | 'gt' | 'lt' | 'between' | 'missing' | 'present';
    value?: string;
    value2?: string;
  };
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
  | 'currency'
  /** A result as a large number with unit and bands (3.1). */
  | 'kpi'
  /** A list or DataGrid result as horizontal bars (3.1). */
  | 'barchart'
  /** A returned image: base64, a data URL or an https link (3.1). */
  | 'image'
  /** A DataGrid input edited in place, with CSV fill (3.1). */
  | 'datagrid'
  /** A checkbox per option for a list (array) input (3.1). */
  | 'checkboxgroup';

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
  /** KPI tile (3.1): text after the number ("ms", "points"). */
  unit?: string;
  /** KPI tile (3.1): bands checked in order; the first the value is below wins. */
  kpiBands?: KpiBand[];
  /** Bar chart (3.1): DataGrid column for the bar labels (default: the first text column). */
  chartLabelColumn?: string;
  /** Bar chart (3.1): DataGrid column for the bar values (default: the first number column). */
  chartValueColumn?: string;
  /** Bar chart (3.1): sort the bars by value. */
  chartSort?: 'desc' | 'asc';
  /** Bar chart (3.1): show only this many bars (the table view shows all). */
  chartTop?: number;
  /** Image output (3.1): alternative text for screen readers (default: the label). */
  imageAlt?: string;
  /** Image output (3.1): largest height in pixels. */
  imageMaxHeight?: number;
  /** DataGrid editor (3.1): the grid's columns (usually read from the decision). */
  gridColumns?: { name: string; dataType: string }[];
  /** DataGrid editor (3.1): most rows (default: the decision's limit, else 1000). */
  maxRows?: number;
  /** Checkbox group (3.1): fewest and most options that may be ticked. */
  minChecked?: number;
  maxChecked?: number;
}

/** A KPI band: values below `below` (or any value, when unset) get this word and colour. */
export interface KpiBand {
  below?: number;
  label: string;
  tone: 'good' | 'warning' | 'critical' | 'info' | 'neutral';
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
  /** Show the SAS Model Manager model behind a model module (3.1). */
  showModelInfo?: boolean;
  /** Messages shown after a run when a result meets a condition (3.1). */
  messageRules?: MessageRule[];
  /** Offer the last run's inputs and results as a file (3.1). */
  downloads?: ('csv' | 'json')[];
  /** Offer "Score a file": every row of a CSV file, with progress and a results download (3.1). */
  batchFromFile?: boolean;
  /** Show the last runs in this browser tab, to restore inputs or compare two runs (3.1). */
  runHistory?: boolean;
  /** Offer "Save as test case": the last run saved as a decision scenario (3.1). */
  saveScenario?: boolean;
  /** Append every run to a CAS table, as an audit log (3.1). */
  runLog?: { caslib: string; table: string };
}

/** "When <result> <op> <value>, show <message>": only compares what MAS returned. */
export interface MessageRule {
  id: string;
  /** The result (output parameter) name. */
  result: string;
  op: 'eq' | 'ne' | 'gt' | 'lt' | 'between' | 'missing';
  value?: string;
  /** The upper end for 'between'. */
  value2?: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

export type SubmitPosition = 'top' | 'afterInputs' | 'bottom';
