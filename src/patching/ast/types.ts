export interface ASTTransformOptions {
  targetPath: string;
  source: string;
  scriptSrc?: string | null;
}

export interface GeneratedPatch {
  fixId: string;
  targetPath: string;
  originalContent: string;
  patchedContent: string;
  unifiedDiff: string;
  hasSyntaxError: boolean;
}

export interface PatchFileResult {
  path: string;
  status: 'patched' | 'skipped';
  patch: GeneratedPatch | null;
  reason?: string;
}