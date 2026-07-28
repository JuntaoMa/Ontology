import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * Render agent-controlled Markdown and sanitize the resulting HTML before it
 * reaches a Vue `v-html` binding.
 */
export function renderSafeMarkdown(markdown: string): string {
  const rendered = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    RETURN_TRUSTED_TYPE: false,
  });
}
