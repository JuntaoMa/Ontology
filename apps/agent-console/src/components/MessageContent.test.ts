// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import MessageContent from './MessageContent.vue';

describe('MessageContent', () => {
  it('renders a complete assistant JSON document as escaped, formatted code', () => {
    const content =
      '{"schema_version":"data-query-plan.v1","unsafe":"</code><img src=x onerror=alert(1)>"}';
    const wrapper = mount(MessageContent, {
      props: { content, formatJson: true },
    });

    const code = wrapper.get('pre > code.language-json');
    expect(code.text()).toBe(JSON.stringify(JSON.parse(content), null, 2));
    expect(wrapper.get('summary').text()).toBe('查询Plan');
    expect(
      wrapper.get('details.formal-output-card').attributes('open'),
    ).toBeUndefined();
    expect(wrapper.get('.formal-output-icon').attributes('data-icon')).toBe(
      'plan',
    );
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.html()).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(wrapper.props('content')).toBe(content);
  });

  it('falls back to sanitized Markdown until a JSON document is complete', async () => {
    const wrapper = mount(MessageContent, {
      props: { content: '{"schema_version":', formatJson: true },
    });

    expect(wrapper.find('pre').exists()).toBe(false);

    await wrapper.setProps({
      content: '{"schema_version":"data-query-plan.v1"}',
    });

    expect(wrapper.get('pre > code.language-json').text()).toContain(
      '"schema_version": "data-query-plan.v1"',
    );
  });

  it('keeps leading prose and folds a final fenced JSON block into 查询Plan', () => {
    const content = [
      'I found the ontology path.',
      '',
      '```json',
      '{"schema_version":"data-query-plan.v1","limit":5}',
      '```',
    ].join('\n');
    const wrapper = mount(MessageContent, {
      props: { content, formatJson: true },
    });

    expect(wrapper.get('p').text()).toBe('I found the ontology path.');
    expect(wrapper.get('summary').text()).toBe('查询Plan');
    expect(wrapper.get('pre > code.language-json').text()).toContain(
      '"limit": 5',
    );
    expect(wrapper.props('content')).toBe(content);
  });

  it('does not auto-format JSON when the caller marks it as user content', () => {
    const wrapper = mount(MessageContent, {
      props: { content: '{"question":"hello"}', formatJson: false },
    });

    expect(wrapper.find('pre').exists()).toBe(false);
    expect(wrapper.get('p').text()).toBe('{"question":"hello"}');
  });

  it('keeps ordinary Markdown rendering and sanitization', () => {
    const wrapper = mount(MessageContent, {
      props: {
        content: '# Result\n\n<script>alert(1)</script>Safe',
        formatJson: true,
      },
    });

    expect(wrapper.get('h1').text()).toBe('Result');
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.text()).toContain('Safe');
  });
});
