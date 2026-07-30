import DOMPurify from 'dompurify';
import { marked } from 'marked';

const MARKDOWN_TAGS = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
] as const;

/**
 * Render agent-controlled Markdown and sanitize the resulting HTML before it
 * reaches a Vue `v-html` binding. The allowlist contains only passive
 * Markdown presentation primitives; Agent HTML cannot create forms, controls,
 * overlays, ids, classes or inline styles that impersonate Console UI.
 */
export function renderSafeMarkdown(markdown: string): string {
  const rendered = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: [...MARKDOWN_TAGS],
    ALLOWED_ATTR: ['href', 'title', 'src', 'alt', 'align'],
    RETURN_TRUSTED_TYPE: false,
  });
}
