/**
 * Format a complete JSON document for display without changing the source
 * message stored by ACP/OpenCode.
 *
 * JSON scalars intentionally fall back to Markdown so ordinary messages such
 * as `true`, `null`, or a quoted string are not unexpectedly rendered as code.
 */
export function tryFormatJsonDocument(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null;

  try {
    const value: unknown = JSON.parse(trimmed);
    if (typeof value !== 'object' || value === null) return null;
    return formatJsonWhitespace(trimmed);
  } catch {
    return null;
  }
}

export interface JsonOutputPresentation {
  leadingMarkdown: string;
  formattedJson: string;
}

/**
 * Find the final structured query result without changing the source message.
 *
 * Agents commonly emit a short explanation followed by a fenced `json` block.
 * Treat that final, complete object/array as the formal output while preserving
 * the leading prose as ordinary sanitized Markdown.
 */
export function tryPresentJsonOutput(
  source: string,
): JsonOutputPresentation | null {
  const document = tryFormatJsonDocument(source);
  if (document !== null) {
    return { leadingMarkdown: '', formattedJson: document };
  }

  const candidate = source.trimEnd();
  const fencedJson =
    /(?:^|\r?\n)(`{3,}|~{3,})[ \t]*(?:json|application\/json)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/i.exec(
      candidate,
    );
  if (!fencedJson) return null;

  const formattedJson = tryFormatJsonDocument(fencedJson[2]);
  if (formattedJson === null) return null;

  return {
    leadingMarkdown: candidate.slice(0, fencedJson.index).trimEnd(),
    formattedJson,
  };
}

/**
 * Re-indent validated JSON while retaining the Agent's original string,
 * number, key-order, and duplicate-key lexemes. In particular, this avoids
 * rounding integers that exceed JavaScript's safe numeric range.
 */
function formatJsonWhitespace(source: string): string {
  let output = '';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (/\s/.test(character)) continue;

    switch (character) {
      case '{':
      case '[': {
        output += character;
        depth += 1;
        const closing = character === '{' ? '}' : ']';
        if (nextNonWhitespace(source, index + 1) !== closing) {
          output += `\n${indent(depth)}`;
        }
        break;
      }
      case '}':
      case ']': {
        depth -= 1;
        const opening = character === '}' ? '{' : '[';
        if (previousNonWhitespace(source, index - 1) !== opening) {
          output += `\n${indent(depth)}`;
        }
        output += character;
        break;
      }
      case ',':
        output += `,\n${indent(depth)}`;
        break;
      case ':':
        output += ': ';
        break;
      default:
        output += character;
    }
  }

  return output;
}

function indent(depth: number): string {
  return '  '.repeat(Math.max(0, depth));
}

function nextNonWhitespace(source: string, start: number): string | undefined {
  for (let index = start; index < source.length; index += 1) {
    if (!/\s/.test(source[index])) return source[index];
  }
  return undefined;
}

function previousNonWhitespace(source: string, start: number): string | undefined {
  for (let index = start; index >= 0; index -= 1) {
    if (!/\s/.test(source[index])) return source[index];
  }
  return undefined;
}
