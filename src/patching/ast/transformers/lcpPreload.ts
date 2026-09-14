import ts from 'typescript5';
import {
  applyEdits,
  collectJsxTargets,
  hasJsxAttribute,
  parseSource,
} from '../internal';

export const LCP_PRELOAD_LINK =
  '<link rel="preload" as="image" href="/hero.webp" fetchpriority="high" />';

export function transformLcpPreload(source: string, filename: string): string {
  if (
    source.includes('fetchpriority="high"') ||
    source.includes('rel="preload"')
  ) {
    return source;
  }

  const sourceFile = parseSource(source, filename);
  const image = collectJsxTargets(sourceFile).find(
    (target) => target.tagName === 'img' || target.tagName === 'Image',
  );

  if (image === undefined) {
    const insertPos = lastImportEnd(sourceFile);
    const prefix =
      insertPos >= 0
        ? `\n\n${LCP_PRELOAD_LINK}\n`
        : `${LCP_PRELOAD_LINK}\n`;
    return applyEdits(source, [{ start: insertPos === -1 ? 0 : insertPos, text: prefix }]);
  }

  const guard =
    image.tagName === 'Image'
      ? ['priority', 'loading', 'fetchpriority'].some((name) =>
          hasJsxAttribute(image.attributes, name),
        )
      : hasJsxAttribute(image.attributes, 'fetchpriority');

  if (guard) return source;

  const attribute =
    image.tagName === 'Image' ? 'priority' : 'fetchpriority="high"';
  return applyEdits(source, [
    { start: image.insertPos, text: ` ${attribute}` },
  ]);
}

function lastImportEnd(sourceFile: ts.SourceFile): number {
  let last = -1;
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isVariableStatement(statement)
    ) {
      last = Math.max(last, statement.getEnd());
    }
  }
  return last;
}