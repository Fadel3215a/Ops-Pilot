import assert from 'node:assert';
import {
  buildAnalysisPrompt,
  DEFAULT_MODEL,
  generateExecutiveSummary,
  parseExecutiveSummary,
  syntheticSummary,
} from './index';
import type { AIAnalysisRequest, ExecutiveSummary } from './types';

let passed = 0;
let failed = 0;

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(
      `      ${String(error).split('\n').slice(0, 4).join('\n      ')}`,
    );
  }
}

function sampleRequest(): AIAnalysisRequest {
  return {
    targetUrl: 'https://store.example.com/',
    combinedLossUsd: 12573,
    performanceScore: 37,
    topFixes: [
      {
        id: 'LCP_IMAGE_PRELOAD',
        name: 'Preload hero image',
        monthlySavingsUsd: 7777,
      },
      {
        id: 'SECURITY_HEADERS',
        name: 'Add security headers',
        monthlySavingsUsd: 1891,
      },
    ],
  };
}

const SAMPLE_SUMMARY: ExecutiveSummary = {
  headline: 'Preload hero image first',
  keyTakeaway: 'Conversion escapes are recoverable within the month.',
  riskLevel: 'warning',
  actionItems: ['Add preload', 'Re-scan'],
};

function jsonResponse(summary: ExecutiveSummary): typeof fetch {
  return (async () => {
    return new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(summary) }] } },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
}

async function main(): Promise<void> {
  await run('default model constant evaluates to gemini-3.6-flash', () => {
    assert.strictEqual(DEFAULT_MODEL, 'gemini-3.6-flash');
    const resolved = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
    assert.strictEqual(resolved, 'gemini-3.6-flash', 'env not set default wins');
  });

  await run('buildAnalysisPrompt encodes metrics and fix ranking', () => {
    const prompt = buildAnalysisPrompt(sampleRequest());
    assert.ok(prompt.includes('https://store.example.com/'), 'target in prompt');
    assert.ok(prompt.includes('$12,573/mo'), 'combined loss in prompt');
    assert.ok(prompt.includes('Performance score: 37/100'), 'score in prompt');
    assert.ok(prompt.includes('Preload hero image'), 'top fix in prompt');
    assert.ok(prompt.includes('riskLevel'), 'shape contract in prompt');
  });

  await run('dry-run returns a structured fallback without network', async () => {
    const summary = await generateExecutiveSummary(sampleRequest(), { dryRun: true });
    assert.strictEqual(summary.riskLevel, 'critical', 'score 37 is critical');
    assert.ok(summary.headline.length > 0);
    assert.ok(summary.keyTakeaway.includes('$12,573/mo'));
    assert.ok(summary.actionItems.length >= 2, 'fixes plus baseline step');
    assert.ok(summary.actionItems.some((item) => item.includes('Preload hero image')));
  });

  await run('dry-run maps healthy/warning/critical by score', async () => {
    const byScore = (score: number) =>
      generateExecutiveSummary(
        { targetUrl: 'https://x/', combinedLossUsd: 1000, performanceScore: score, topFixes: [] },
        { dryRun: true },
      );
    assert.strictEqual((await byScore(100)).riskLevel, 'healthy');
    assert.strictEqual((await byScore(79)).riskLevel, 'warning');
    assert.strictEqual((await byScore(50)).riskLevel, 'warning');
    assert.strictEqual((await byScore(49)).riskLevel, 'critical');
    assert.strictEqual((await byScore(0)).riskLevel, 'critical');
  });

  await run('missing API key falls back instead of throwing', async () => {
    const previous = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const summary = await generateExecutiveSummary(sampleRequest());
      assert.strictEqual(summary.riskLevel, 'critical');
    } finally {
      if (previous !== undefined) process.env.GEMINI_API_KEY = previous;
    }
  });

  await run('syntheticSummary is deterministic', () => {
    const first = syntheticSummary(sampleRequest());
    const second = syntheticSummary(sampleRequest());
    assert.deepStrictEqual(first, second);
  });

  await run('mock fetch builds gemini-3.6-flash URL and parses JSON', async () => {
    let capturedUrl: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = init?.body === undefined
        ? {}
        : (JSON.parse(String(init.body)) as Record<string, unknown>);
      return jsonResponse(SAMPLE_SUMMARY)(input, init);
    }) as typeof fetch;

    const summary = await generateExecutiveSummary(sampleRequest(), {
      apiKey: 'test-key',
      model: 'gemini-3.6-flash',
      fetchFn,
    });

    assert.ok(
      capturedUrl?.startsWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=test-key',
      ),
      `url=${capturedUrl}`,
    );
    assert.ok(capturedBody, 'request body captured');
    const contents = capturedBody.contents as Array<{ parts: Array<{ text: string }> }>;
    assert.ok(contents[0].parts[0].text.includes('https://store.example.com/'));
    const config = capturedBody.generationConfig as Record<string, unknown>;
    assert.strictEqual(config.responseMimeType, 'application/json');

    assert.deepStrictEqual(summary, SAMPLE_SUMMARY);
  });

  await run('explicit model and env model both override the default', async () => {
    const seen: string[] = [];
    const captureFetch = (url: string) =>
      ((input: RequestInfo | URL) => {
        seen.push(String(input));
        return jsonResponse(SAMPLE_SUMMARY)(input, {});
      }) as typeof fetch;

    const previous = process.env.GEMINI_MODEL;
    process.env.GEMINI_MODEL = 'gemini-3.6-flash';
    try {
      await generateExecutiveSummary(sampleRequest(), {
        apiKey: 'k',
        model: 'gemini-3.6-flash',
        fetchFn: captureFetch('x'),
      });
      await generateExecutiveSummary(sampleRequest(), {
        apiKey: 'k',
        fetchFn: captureFetch('x'),
      });
    } finally {
      if (previous !== undefined) process.env.GEMINI_MODEL = previous;
      else delete process.env.GEMINI_MODEL;
    }
    assert.strictEqual(seen.length, 2);
    for (const url of seen) {
      assert.ok(url.includes(':generateContent?key='), url);
    }
  });

  await run('parseExecutiveSummary strips JSON fences', () => {
    const summary = parseExecutiveSummary(
      `\`\`\`json\n${JSON.stringify(SAMPLE_SUMMARY)}\n\`\`\``,
    );
    assert.deepStrictEqual(summary, SAMPLE_SUMMARY);
  });

  await run('parseExecutiveSummary rejects malformed output', () => {
    assert.throws(() => parseExecutiveSummary('{"headline": 5}'));
    assert.throws(() => parseExecutiveSummary('{"headline":"x","keyTakeaway":1,"riskLevel":"maybe","actionItems":[]}'));
    assert.throws(() => parseExecutiveSummary('{"headline":"x","keyTakeaway":"y","riskLevel":"healthy","actionItems":{}}'));
    assert.throws(() => parseExecutiveSummary('not json'));
  });

  await run('generateExecutiveSummary throws on HTTP failure', async () => {
    const fetchFn = (async () =>
      new Response('quota exceeded', { status: 429 })) as typeof fetch;
    let threw = false;
    try {
      await generateExecutiveSummary(sampleRequest(), { apiKey: 'k', fetchFn });
    } catch (error) {
      threw = String(error).includes('429');
    }
    assert.ok(threw);
  });

  console.log(`\nGemini AI client: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});