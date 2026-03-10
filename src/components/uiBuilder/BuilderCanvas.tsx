// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { UIDefinition, UISection, UIField } from '../../types/uiBuilder';
import { Step } from '../../types';
import { FieldConfigPanel } from './FieldConfigPanel';
import { widgetLabels } from './widgetMap';
import { Button } from '../common/Button';

interface Props {
  definition: UIDefinition;
  step: Step | null;
  onChange: (definition: UIDefinition) => void;
}

export const BuilderCanvas: React.FC<Props> = ({ definition, step, onChange }) => {
  const [selectedField, setSelectedField] = useState<{ sectionId: string; fieldIdx: number } | null>(null);

  const updateSection = (sectionId: string, updater: (section: UISection) => UISection) => {
    const sections = definition.layout.sections.map(s =>
      s.id === sectionId ? updater(s) : s
    );
    onChange({ ...definition, layout: { ...definition.layout, sections } });
  };

  const handleFieldUpdate = (sectionId: string, fieldIdx: number, field: UIField) => {
    updateSection(sectionId, section => ({
      ...section,
      fields: section.fields.map((f, i) => i === fieldIdx ? field : f),
    }));
  };

  const handleMoveField = (sectionId: string, fieldIdx: number, direction: -1 | 1) => {
    updateSection(sectionId, section => {
      const fields = [...section.fields];
      const targetIdx = fieldIdx + direction;
      if (targetIdx < 0 || targetIdx >= fields.length) return section;
      // Swap orders
      const tmpOrder = fields[fieldIdx].order;
      fields[fieldIdx] = { ...fields[fieldIdx], order: fields[targetIdx].order };
      fields[targetIdx] = { ...fields[targetIdx], order: tmpOrder };
      // Swap positions
      [fields[fieldIdx], fields[targetIdx]] = [fields[targetIdx], fields[fieldIdx]];
      return { ...section, fields };
    });
  };

  const handleMoveSection = (idx: number, direction: -1 | 1) => {
    const sections = [...definition.layout.sections];
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= sections.length) return;
    [sections[idx], sections[targetIdx]] = [sections[targetIdx], sections[idx]];
    onChange({ ...definition, layout: { ...definition.layout, sections } });
  };

  const handleSectionTitleChange = (sectionId: string, title: string) => {
    updateSection(sectionId, s => ({ ...s, title }));
  };

  const handleAddSection = () => {
    const newSection: UISection = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: 'New Section',
      fields: [],
    };
    onChange({
      ...definition,
      layout: {
        ...definition.layout,
        sections: [...definition.layout.sections, newSection],
      },
    });
  };

  const handleAddTextBlock = (sectionId: string) => {
    const newField: UIField = {
      parameterId: `text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      direction: 'static',
      label: 'Text Block',
      widget: 'markdown',
      visible: true,
      order: 999,
      defaultValue: '**Hello!** Enter your markdown here.',
      width: 'full',
    };
    updateSection(sectionId, section => ({
      ...section,
      fields: [...section.fields, { ...newField, order: section.fields.length }],
    }));
  };

  const handleRemoveField = (sectionId: string, fieldIdx: number) => {
    updateSection(sectionId, section => ({
      ...section,
      fields: section.fields.filter((_, i) => i !== fieldIdx),
    }));
    if (selectedField?.sectionId === sectionId && selectedField?.fieldIdx === fieldIdx) {
      setSelectedField(null);
    }
  };

  const handleMoveFieldToSection = (fromSectionId: string, fieldIdx: number, toSectionId: string) => {
    if (fromSectionId === toSectionId) return;
    const fromSection = definition.layout.sections.find(s => s.id === fromSectionId);
    if (!fromSection) return;
    const field = fromSection.fields[fieldIdx];
    if (!field) return;

    const sections = definition.layout.sections.map(s => {
      if (s.id === fromSectionId) {
        return { ...s, fields: s.fields.filter((_, i) => i !== fieldIdx) };
      }
      if (s.id === toSectionId) {
        return { ...s, fields: [...s.fields, { ...field, order: s.fields.length }] };
      }
      return s;
    });
    onChange({ ...definition, layout: { ...definition.layout, sections } });
    // Update selection to the new location
    const toSection = sections.find(s => s.id === toSectionId);
    if (toSection) {
      setSelectedField({ sectionId: toSectionId, fieldIdx: toSection.fields.length - 1 });
    }
  };

  const handleRemoveSection = (sectionId: string) => {
    onChange({
      ...definition,
      layout: {
        ...definition.layout,
        sections: definition.layout.sections.filter(s => s.id !== sectionId),
      },
    });
    if (selectedField?.sectionId === sectionId) setSelectedField(null);
  };

  const allParameters = step
    ? [...(step.inputs ?? []), ...(step.outputs ?? [])]
    : [];

  const getParameter = (parameterId: string) => {
    return allParameters.find(p => p.name === parameterId) ?? null;
  };

  // Collect all parameterId values currently used across all fields
  const usedParameterIds = new Set(
    definition.layout.sections.flatMap(s => s.fields.map(f => f.parameterId))
  );

  const getSelectedField = (): UIField | null => {
    if (!selectedField) return null;
    const section = definition.layout.sections.find(s => s.id === selectedField.sectionId);
    return section?.fields[selectedField.fieldIdx] ?? null;
  };

  const currentField = getSelectedField();

  return (
    <div className="ui-builder__canvas-wrapper">
      <div className="ui-builder__canvas">
        {definition.layout.sections.map((section, sIdx) => (
          <div key={section.id} className="ui-builder__section">
            <div className="ui-builder__section-header">
              <div className="ui-builder__section-move">
                <button
                  className="ui-builder__move-btn"
                  onClick={() => handleMoveSection(sIdx, -1)}
                  disabled={sIdx === 0}
                  title="Move up"
                >&#9650;</button>
                <button
                  className="ui-builder__move-btn"
                  onClick={() => handleMoveSection(sIdx, 1)}
                  disabled={sIdx === definition.layout.sections.length - 1}
                  title="Move down"
                >&#9660;</button>
              </div>
              <input
                type="text"
                className="sas-input ui-builder__section-title-input"
                value={section.title ?? ''}
                onChange={(e) => handleSectionTitleChange(section.id, e.target.value)}
                placeholder="Section title"
              />
              <button
                className="ui-builder__section-remove"
                onClick={() => handleRemoveSection(section.id)}
                title="Remove section"
              >&times;</button>
            </div>

            <div className="ui-builder__field-list">
              {section.fields.map((field, fIdx) => (
                <div
                  key={field.parameterId}
                  className={`ui-builder__field-row ${
                    selectedField?.sectionId === section.id && selectedField?.fieldIdx === fIdx
                      ? 'ui-builder__field-row--selected' : ''
                  } ${!field.visible ? 'ui-builder__field-row--hidden' : ''}`}
                  onClick={() => setSelectedField({ sectionId: section.id, fieldIdx: fIdx })}
                >
                  <div className="ui-builder__field-move">
                    <button
                      className="ui-builder__move-btn"
                      onClick={(e) => { e.stopPropagation(); handleMoveField(section.id, fIdx, -1); }}
                      disabled={fIdx === 0}
                    >&#9650;</button>
                    <button
                      className="ui-builder__move-btn"
                      onClick={(e) => { e.stopPropagation(); handleMoveField(section.id, fIdx, 1); }}
                      disabled={fIdx === section.fields.length - 1}
                    >&#9660;</button>
                  </div>
                  <div className="ui-builder__field-info">
                    <span className="ui-builder__field-label">{field.label}</span>
                    <span className="ui-builder__field-meta">
                      <span className={`ui-builder__direction-badge ui-builder__direction-badge--${field.direction}`}>
                        {field.direction === 'input' ? 'IN' : field.direction === 'output' ? 'OUT' : 'TXT'}
                      </span>
                      {' '}
                      {field.direction !== 'static' ? field.parameterId : 'Static content'}
                      {' / '}
                      {widgetLabels[field.widget]}
                      {' / '}
                      {field.width}
                    </span>
                  </div>
                  <div className="ui-builder__field-badges">
                    {!field.visible && <span className="ui-builder__hidden-badge">Hidden</span>}
                    {field.direction === 'static' && (
                      <button
                        className="ui-builder__option-remove"
                        onClick={(e) => { e.stopPropagation(); handleRemoveField(section.id, fIdx); }}
                        title="Remove text block"
                      >&times;</button>
                    )}
                  </div>
                </div>
              ))}
              {section.fields.length === 0 && (
                <div className="ui-builder__field-empty">
                  No fields in this section
                </div>
              )}
              <div className="ui-builder__field-list-actions">
                <Button
                  variant="tertiary"
                  size="small"
                  onClick={() => handleAddTextBlock(section.id)}
                >
                  + Text Block
                </Button>
              </div>
            </div>
          </div>
        ))}

        <Button variant="secondary" onClick={handleAddSection} fullWidth>
          Add Section
        </Button>
      </div>

      {/* Config Panel */}
      {currentField && selectedField && (
        <FieldConfigPanel
          field={currentField}
          parameter={getParameter(currentField.parameterId)}
          allParameters={allParameters}
          usedParameterIds={usedParameterIds}
          sections={definition.layout.sections}
          currentSectionId={selectedField.sectionId}
          onChange={(f) => handleFieldUpdate(selectedField.sectionId, selectedField.fieldIdx, f)}
          onMoveToSection={(targetId) => handleMoveFieldToSection(selectedField.sectionId, selectedField.fieldIdx, targetId)}
          onClose={() => setSelectedField(null)}
        />
      )}
    </div>
  );
};
