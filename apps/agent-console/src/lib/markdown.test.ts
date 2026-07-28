// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { renderSafeMarkdown } from './markdown';

describe('renderSafeMarkdown', () => {
  it('retains Markdown formatting while stripping executable HTML', () => {
    const html = renderSafeMarkdown(
      '# Result\n\n<strong>safe</strong><script>alert(1)</script><img src="x" onerror="alert(2)">',
    );

    expect(html).toContain('<h1>Result</h1>');
    expect(html).toContain('<strong>safe</strong>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });

  it('removes unsafe URL schemes', () => {
    const html = renderSafeMarkdown('<a href="javascript:alert(1)">click</a>');

    expect(html).toContain('click');
    expect(html).not.toContain('javascript:');
  });
});
