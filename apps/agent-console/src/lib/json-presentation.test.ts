import { describe, expect, it } from 'vitest';
import {
  tryFormatJsonDocument,
  tryPresentJsonOutput,
} from './json-presentation';

describe('tryFormatJsonDocument', () => {
  it('formats a complete JSON object with two-space indentation', () => {
    const source = ' \n{"schema_version":"data-query-plan.v1","query":{"limit":5}}\n';

    expect(tryFormatJsonDocument(source)).toBe(
      [
        '{',
        '  "schema_version": "data-query-plan.v1",',
        '  "query": {',
        '    "limit": 5',
        '  }',
        '}',
      ].join('\n'),
    );
    expect(source).toBe(' \n{"schema_version":"data-query-plan.v1","query":{"limit":5}}\n');
  });

  it('formats a complete top-level JSON array', () => {
    expect(tryFormatJsonDocument('[{"name":"Room"},{"name":"Building"}]')).toBe(
      [
        '[',
        '  {',
        '    "name": "Room"',
        '  },',
        '  {',
        '    "name": "Building"',
        '  }',
        ']',
      ].join('\n'),
    );
  });

  it('retains number lexemes and duplicate keys from the Agent output', () => {
    const source =
      '{"id":9007199254740993,"duplicate":1,"duplicate":2,"scientific":1e+06}';

    expect(tryFormatJsonDocument(source)).toBe(
      [
        '{',
        '  "id": 9007199254740993,',
        '  "duplicate": 1,',
        '  "duplicate": 2,',
        '  "scientific": 1e+06',
        '}',
      ].join('\n'),
    );
  });

  it('does not interpret structural characters inside strings', () => {
    const source = '{"text":"a, b: {c} [d] \\"quoted\\"","empty":{}}';

    expect(tryFormatJsonDocument(source)).toBe(
      [
        '{',
        '  "text": "a, b: {c} [d] \\"quoted\\"",',
        '  "empty": {}',
        '}',
      ].join('\n'),
    );
  });

  it.each([
    '',
    'true',
    'null',
    '"plain message"',
    '{"incomplete":',
    'Result:\n{"valid":true}',
    '```json\n{"valid":true}\n```',
  ])('leaves non-document content for the Markdown renderer: %j', (source) => {
    expect(tryFormatJsonDocument(source)).toBeNull();
  });
});

describe('tryPresentJsonOutput', () => {
  it('extracts a final fenced JSON plan while preserving leading Markdown', () => {
    const source = [
      'I found the ontology path.',
      '',
      '```json',
      '{"schema_version":"data-query-plan.v1","limit":5}',
      '```',
      '',
    ].join('\n');

    expect(tryPresentJsonOutput(source)).toEqual({
      leadingMarkdown: 'I found the ontology path.',
      formattedJson: [
        '{',
        '  "schema_version": "data-query-plan.v1",',
        '  "limit": 5',
        '}',
      ].join('\n'),
    });
    expect(source).toContain('```json');
  });

  it('supports a complete JSON document without leading prose', () => {
    expect(tryPresentJsonOutput('{"plan":[]}')).toEqual({
      leadingMarkdown: '',
      formattedJson: ['{', '  "plan": []', '}'].join('\n'),
    });
  });

  it.each([
    'Explanation\n\n```json\n{"incomplete":\n```',
    'Explanation\n\n```text\n{"valid":true}\n```',
    '```json\ntrue\n```',
    'Explanation\n\n```json\n{"valid":true}\n```\nTrailing text',
  ])('does not promote a non-final or invalid formal block: %j', (source) => {
    expect(tryPresentJsonOutput(source)).toBeNull();
  });
});
