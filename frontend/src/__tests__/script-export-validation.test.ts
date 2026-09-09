import { describe, expect, it } from 'vitest';

import { validateExportDocument } from '@/components/modules/ScriptEditor/dialogs/serializers';

describe('script export structure validation', () => {
  it('rejects an empty document before a professional export', () => {
    expect(validateExportDocument({ type: 'doc', content: [] }, 'pdf')).toEqual({
      code: 'empty_document',
    });
    expect(validateExportDocument({ type: 'doc', content: [{ type: 'paragraph' }] }, 'pdf')).toEqual({
      code: 'empty_document',
    });
  });

  it('rejects node types without a mapping for the selected format', () => {
    expect(validateExportDocument({
      type: 'doc',
      content: [{ type: 'shotBlock', content: [{ type: 'text', text: '镜头' }] }],
    }, 'fdx')).toEqual({
      code: 'unsupported_node',
      nodeType: 'shotBlock',
    });
  });

  it('accepts mapped screenplay nodes for PDF and Fountain', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. STATION - NIGHT' }] },
        { type: 'action', content: [{ type: 'text', text: 'Rain hits the platform.' }] },
        { type: 'characterCue', content: [{ type: 'text', text: 'LIN' }] },
        { type: 'dialogue', content: [{ type: 'text', text: 'We should go.' }] },
      ],
    };

    expect(validateExportDocument(doc, 'pdf')).toBeNull();
    expect(validateExportDocument(doc, 'fountain')).toBeNull();
  });

  it('reports formats that are not supported by the export contract', () => {
    expect(validateExportDocument({ type: 'doc', content: [{ type: 'action' }] }, 'rtf')).toEqual({
      code: 'unsupported_format',
      format: 'rtf',
    });
  });
});
