import ts from 'typescript5';

export interface TextEdit {
  start: number;
  text: string;
}

export interface JsxTarget {
  tagName: string;
  attributes: ts.JsxAttributes;
  insertPos: number;
}

export function scriptKindForPath(filename: string): ts.ScriptKind {
  if (filename.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filename.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filename.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function parseSource(source: string, filename: string): ts.SourceFile {
  return ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(filename),
  );
}

export function hasSyntaxError(source: string, filename: string): boolean {
  const result = ts.transpileModule(source, {
    reportDiagnostics: true,
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.Latest,
      jsx: ts.JsxEmit.Preserve,
      allowJs: true,
    },
  });
  return (result.diagnostics ?? []).length > 0;
}

export function collectJsxTargets(sourceFile: ts.SourceFile): JsxTarget[] {
  const targets: JsxTarget[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node)) {
      targets.push({
        tagName: jsxTagName(node.tagName),
        attributes: node.attributes,
        insertPos: node.tagName.getEnd(),
      });
    } else if (ts.isJsxOpeningElement(node)) {
      targets.push({
        tagName: jsxTagName(node.tagName),
        attributes: node.attributes,
        insertPos: node.tagName.getEnd(),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return targets;
}

function jsxTagName(tagName: ts.JsxTagNameExpression): string {
  return ts.isIdentifier(tagName) ? tagName.text : tagName.getText();
}

export function jsxAttributeNames(attributes: ts.JsxAttributes): string[] {
  const names: string[] = [];
  for (const attribute of attributes.properties) {
    if (ts.isJsxAttribute(attribute)) {
      names.push(jsxAttributeName(attribute));
    } else if (ts.isJsxSpreadAttribute(attribute)) {
      names.push('...spread');
    }
  }
  return names;
}

function jsxAttributeName(attribute: ts.JsxAttribute): string {
  return ts.isIdentifier(attribute.name)
    ? attribute.name.text
    : attribute.name.getText();
}

export function hasJsxAttribute(
  attributes: ts.JsxAttributes,
  name: string,
): boolean {
  return jsxAttributeNames(attributes).includes(name);
}

export function findJsxAttribute(
  attributes: ts.JsxAttributes,
  name: string,
): ts.JsxAttribute | undefined {
  for (const attribute of attributes.properties) {
    if (ts.isJsxAttribute(attribute) && jsxAttributeName(attribute) === name) {
      return attribute;
    }
  }
  return undefined;
}

export function jsxAttributeValue(attribute: ts.JsxAttribute): string | null {
  const initializer = attribute.initializer;
  if (initializer === undefined) return null;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer)) {
    const expression = initializer.expression;
    if (expression !== undefined && ts.isStringLiteral(expression)) {
      return expression.text;
    }
  }
  return null;
}

export function applyEdits(source: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let output = source;
  for (const edit of sorted) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.start);
  }
  return output;
}