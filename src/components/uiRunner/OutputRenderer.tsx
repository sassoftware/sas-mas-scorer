// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UILayout } from '../../types/uiBuilder';
import { DynamicForm } from './DynamicForm';

interface Props {
  layout: UILayout;
  outputValues: Record<string, unknown>;
}

export const OutputRenderer: React.FC<Props> = ({ layout, outputValues }) => {
  return (
    <DynamicForm
      layout={layout}
      inputValues={{}}
      outputValues={outputValues}
      onInputChange={() => {}}
      disabled={true}
    />
  );
};
