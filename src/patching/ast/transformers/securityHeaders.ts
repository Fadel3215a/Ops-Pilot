import ts from 'typescript5';
import { parseSource } from '../internal';

const HEADERS_METHOD = `async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  }`;

export function transformSecurityHeaders(
  source: string,
  filename: string,
): string {
  if (source.includes('async headers(')) return source;

  const sourceFile = parseSource(source, filename);
  const target = findConfigObject(sourceFile);

  if (target === undefined) {
    return (
      source +
      `\n\nconst nextConfig = {\n  ${HEADERS_METHOD}\n};\n`
    );
  }

  const { object } = target;
  const insertPos = object.getEnd() - 1;
  const needsComma =
    object.properties.length > 0 &&
    !source.slice(object.properties[object.properties.length - 1].getEnd(), insertPos).includes(',');
  const prefix = needsComma
    ? ',  '
    : object.properties.length === 0
      ? '\n  '
      : '  ';
  return (
    source.slice(0, insertPos) +
    prefix +
    HEADERS_METHOD +
    source.slice(insertPos)
  );
}

interface ConfigObjectTarget {
  object: ts.ObjectLiteralExpression;
}

function findConfigObject(
  sourceFile: ts.SourceFile,
): ConfigObjectTarget | undefined {
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = ts.isIdentifier(declaration.name)
          ? declaration.name.text
          : '';
        if (
          (name === 'nextConfig' || name === 'config') &&
          declaration.initializer !== undefined &&
          ts.isObjectLiteralExpression(declaration.initializer)
        ) {
          return { object: declaration.initializer };
        }
      }
    }

    if (ts.isExportAssignment(statement)) {
      const { expression } = statement;
      if (ts.isObjectLiteralExpression(expression)) {
        return { object: expression };
      }
    }

    if (ts.isExpressionStatement(statement)) {
      const expression = statement.expression;
      if (
        ts.isBinaryExpression(expression) &&
        expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        const left = expression.left;
        if (left.getText(sourceFile) === 'module.exports') {
          const right = expression.right;
          if (ts.isObjectLiteralExpression(right)) {
            return { object: right };
          }
        }
      }
    }
  }
  return undefined;
}