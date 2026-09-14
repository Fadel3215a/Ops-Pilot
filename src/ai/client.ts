import type {
  AIAnalysisRequest,
  ExecutiveSummary,
  RiskLevel,
} from './types';

export const DEFAULT_MODEL = 'gemini-3.6-flash';

const GENERATIVE_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GenerateExecutiveSummaryOptions {
  apiKey?: string;
  model?: string;
  dryRun?: boolean;
  fetchFn?: typeof fetch;
}

interface GeminiTextPart {
  text?: string;
}

interface GeminiContentPart {
  parts?: GeminiTextPart[];
}

interface GeminiCandidate {
  content?: GeminiContentPart;
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
}

const RISK_LEVELS: readonly RiskLevel[] = ['critical', 'warning', 'healthy'];

function usd(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}

export function buildAnalysisPrompt(req: AIAnalysisRequest): string {
  const fixes = req.topFixes
    .map(
      (fix, index) =>
        `${index + 1}. ${fix.name} (${fix.id}) — ${usd(fix.monthlySavingsUsd)}/mo`,
    )
    .join('\n');

  return [
    'You are OpsPilot AI, an executive readiness analyst for e-commerce operations.',
    '',
    'Given the following storefront audit, produce a concise executive summary.',
    '',
    `Target URL: ${req.targetUrl}`,
    `Combined monthly loss: ${usd(req.combinedLossUsd)}/mo`,
    `Performance score: ${req.performanceScore}/100 (higher is better)`,
    'Ranked fixes:',
    fixes.length > 0 ? fixes : 'None recommended.',
    '',
    'Respond with a single JSON object of exactly this shape:',
    '{',
    '  "headline": "short, scannable summary line",',
    '  "keyTakeaway": "one-sentence business takeaway",',
    '  "riskLevel": "critical" | "warning" | "healthy",',
'  "actionItems": ["prioritized concrete action", "..."]',
    '}',
    '',
    'Map riskLevel to the performance score: "critical" below 50,',
    '"warning" from 50 to 79, and "healthy" at 80 or above.',
  ].join('\n');
}

export function syntheticSummary(req: AIAnalysisRequest): ExecutiveSummary {
  const score = req.performanceScore;
  const riskLevel: RiskLevel =
    score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical';

  const top = req.topFixes[0];
  const headline =
    top !== undefined
      ? `${top.name} is the top lever at ${usd(top.monthlySavingsUsd)}/mo`
      : `No high-ROI fixes surfaced for ${req.targetUrl}`;

  const keyTakeaway = [
    `Combined loss of ${usd(req.combinedLossUsd)}/mo with a performance score`,
    `of ${score}/100 is classified as ${riskLevel.toUpperCase()}.`,
  ].join(' ');

  const actionItems =
    req.topFixes.length > 0
      ? req.topFixes.map(
          (fix) => `Apply ${fix.name} (~${usd(fix.monthlySavingsUsd)}/mo savings)`,
        )
      : [];

  actionItems.push(
    'Rescan the storefront after remediation and compare against the baseline.',
  );

  return {
    headline,
    keyTakeaway,
    riskLevel,
    actionItems,
  };
}

function extractGeneratedText(data: GeminiGenerateContentResponse): string {
  const parts = data.candidates?.[0]?.content?.parts;
  const text = parts?.find((part) => typeof part.text === 'string')?.text;
  if (text === undefined || text.trim() === '') {
    throw new Error('Gemini API returned no generated content');
  }
  return text;
}

export function parseExecutiveSummary(raw: string): ExecutiveSummary {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const parsed = JSON.parse(cleaned) as unknown;
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Malformed AI response: expected a JSON object');
  }

  const record = parsed as Record<string, unknown>;
  const headline = record.headline;
  const keyTakeaway = record.keyTakeaway;
  const riskLevel = record.riskLevel;
  const actionItems = record.actionItems;

  if (typeof headline !== 'string' || headline.trim() === '') {
    throw new Error('Malformed AI response: headline must be a string');
  }
  if (typeof keyTakeaway !== 'string' || keyTakeaway.trim() === '') {
    throw new Error('Malformed AI response: keyTakeaway must be a string');
  }
  if (
    typeof riskLevel !== 'string' ||
    !(RISK_LEVELS as readonly string[]).includes(riskLevel)
  ) {
    throw new Error(
      `Malformed AI response: riskLevel must be one of ${RISK_LEVELS.join(', ')}`,
    );
  }
  if (!Array.isArray(actionItems)) {
    throw new Error('Malformed AI response: actionItems must be an array');
  }

  return {
    headline,
    keyTakeaway,
    riskLevel: riskLevel as RiskLevel,
    actionItems: actionItems.map((item) => String(item)),
  };
}

export async function generateExecutiveSummary(
  req: AIAnalysisRequest,
  options: GenerateExecutiveSummaryOptions = {},
): Promise<ExecutiveSummary> {
  const model = options.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? '';

  if (options.dryRun === true || apiKey.trim() === '') {
    return syntheticSummary(req);
  }

  const endpoint = `${GENERATIVE_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  const response = await fetchFn(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: buildAnalysisPrompt(req) }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Gemini API ${model} failed (${response.status}): ${detail.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as GeminiGenerateContentResponse;
  return parseExecutiveSummary(extractGeneratedText(data));
}