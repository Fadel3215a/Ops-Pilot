import {
  applyEdits,
  collectJsxTargets,
  findJsxAttribute,
  hasJsxAttribute,
  jsxAttributeValue,
  parseSource,
} from '../internal';
import type { TextEdit } from '../internal';

export function transformScriptDefer(source: string, filename: string): string {
  const sourceFile = parseSource(source, filename);
  const edits: TextEdit[] = [];

  for (const target of collectJsxTargets(sourceFile)) {
    if (target.tagName !== 'script') continue;
    if (
      hasJsxAttribute(target.attributes, 'defer') ||
      hasJsxAttribute(target.attributes, 'async') ||
      hasJsxAttribute(target.attributes, 'type') ||
      hasJsxAttribute(target.attributes, '...spread')
    ) {
      continue;
    }
    const srcAttribute = findJsxAttribute(target.attributes, 'src');
    if (srcAttribute === undefined) continue;
    const src = jsxAttributeValue(srcAttribute);
    if (src === null) continue;

    const mode = /^https?:\/\//i.test(src) ? 'async' : 'defer';
    edits.push({
      start: target.insertPos,
      text: ` ${mode}`,
    });
  }

  if (edits.length === 0) return source;
  return applyEdits(source, edits);
}