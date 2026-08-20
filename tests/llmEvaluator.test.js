import assert from 'node:assert/strict'
import { buildEvaluatorPrompt, compareModels, evaluateCandidate, parseEvaluationOutput, runBenchmark, scoreBenchmarkCase, validateEvaluationOutput } from '../llm-eval/evaluator.js'
import { createOpenAiCompatibleAdapter, createOpenAiResponsesAdapter } from '../llm-eval/providers/openai.js'
import { loadLocalCredential } from '../llm-eval/credentials.js'

const packet = { title: 'Synthetic Benchmark Show', year: 2025, mediaType: 'tv', synopsis: 'Synthetic intelligent speculative story with an unfamiliar life form and ambitious visual execution.', sources: [{ provider: 'synthetic-test' }] }
const evaluation = {
  viewer1: { fitScore: 82, confidence: 0.8, positiveFactors: ['Credible intelligence institutions'], negativeFactors: [], redFlags: ['Synthetic danger'], positiveMechanismTags: ['credible-professional-behavior'], negativeMechanismTags: [], redFlagTags: ['extreme-suspense'], rationale: 'Synthetic rationale.' },
  viewer2: { fitScore: 76, confidence: 0.7, positiveFactors: ['Grounded investigation'], negativeFactors: [], redFlags: [], positiveMechanismTags: [], negativeMechanismTags: [], redFlagTags: [], rationale: 'Synthetic rationale.' },
  joint: { fitScore: 74, confidence: 0.7, keyAgreementFactors: ['grounded investigation'], keyDisagreementFactors: [], rationale: 'Synthetic rationale.' }
}
const benchmark = { cases: [{ id: 'synthetic-case', researchPacket: 'synthetic-packet.json', expected: { viewer1Range: [80, 85], viewer2Range: [70, 80], jointRange: [70, 75], redFlags: ['extreme-suspense'], positiveMechanisms: ['credible-professional-behavior'] } }] }

assert.equal(buildEvaluatorPrompt({ viewerProfile: '# Synthetic profile', researchPacket: packet }).includes('Do not infer missing traits.'), true)
const evaluatorPrompt = buildEvaluatorPrompt({ viewerProfile: '# Synthetic profile', researchPacket: packet })
assert.equal(evaluatorPrompt.includes('Do not treat an imaginative scientific premise or speculative physics as implausible professional behavior'), true)
assert.equal(evaluatorPrompt.includes('intelligent-science-fiction'), true)
assert.equal(evaluatorPrompt.includes('interesting-aliens'), true)
assert.equal(evaluatorPrompt.includes('visual-imagination-effects'), true)
assert.deepEqual(parseEvaluationOutput(JSON.stringify(evaluation)), evaluation)
assert.throws(() => parseEvaluationOutput('not JSON'), /valid JSON/)
assert.throws(() => validateEvaluationOutput({ ...evaluation, viewer1: { ...evaluation.viewer1, fitScore: 101 } }), /integer from 0 through 100/)
assert.throws(() => validateEvaluationOutput({ ...evaluation, viewer2: { ...evaluation.viewer2, rationale: '' } }), /non-empty/)
assert.throws(() => validateEvaluationOutput({ ...evaluation, viewer2: { ...evaluation.viewer2, positiveMechanismTags: ['unrelated-concept'] } }), /canonical mechanism tags/)
assert.throws(() => validateEvaluationOutput({ ...evaluation, hidden: 'synthetic' }), /not allowed/)

const score = scoreBenchmarkCase(benchmark.cases[0], evaluation)
assert.equal(score.scoreRangeAccuracy, 1)
assert.equal(score.redFlags.recall, 1)
assert.equal(score.positiveMechanisms.recall, 1)
const proseVariant = { ...evaluation, viewer1: { ...evaluation.viewer1, positiveFactors: ['Realistic spy headquarters and credible institutions'], redFlags: ['Tense scenes occur'] } }
assert.equal(scoreBenchmarkCase(benchmark.cases[0], proseVariant).positiveMechanisms.recall, 1)
assert.equal(scoreBenchmarkCase(benchmark.cases[0], proseVariant).redFlags.recall, 1)
const unknownConcept = { ...evaluation, viewer1: { ...evaluation.viewer1, positiveFactors: ['Uncertain musical sensibility'], positiveMechanismTags: [] } }
assert.equal(scoreBenchmarkCase(benchmark.cases[0], unknownConcept).positiveMechanisms.recall, 0)
const scienceFictionEvaluation = { ...evaluation, viewer1: { ...evaluation.viewer1, positiveMechanismTags: ['intelligent-science-fiction', 'interesting-aliens', 'speculative-worldbuilding', 'visual-imagination-effects'] } }
assert.deepEqual(validateEvaluationOutput(scienceFictionEvaluation), scienceFictionEvaluation)

const adapter = { id: 'synthetic', model: 'synthetic-model', async evaluate() { return { text: JSON.stringify(evaluation), usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 }, costUsd: 0.01 } } }
const result = await evaluateCandidate({ adapter, viewerProfile: '# Synthetic profile', researchPacket: packet })
assert.equal(result.evaluation.viewer1.fitScore, 82)
const report = await runBenchmark({ adapter, viewerProfile: '# Synthetic profile', benchmark, loadResearchPacket: async () => packet, repeats: 2 })
assert.equal(report.runs, 2)
assert.equal(report.scoreRangeAccuracy, 1)
assert.equal(report.redFlagRecall, 1)
assert.equal(report.tokenUsage.totalTokens, 40)
assert.equal(report.estimatedOrReportedCostUsd, 0.02)
assert.equal(report.consistency, 1)
const comparison = await compareModels({ adapters: [adapter, { ...adapter, id: 'synthetic-second', model: 'synthetic-second' }], viewerProfile: '# Synthetic profile', benchmark, loadResearchPacket: async () => packet })
assert.equal(comparison.length, 2)

const rateLimited = { id: 'synthetic-rate-limited', model: 'synthetic', async evaluate() { const error = new Error('do not expose a secret'); error.status = 429; throw error } }
const failed = await runBenchmark({ adapter: rateLimited, viewerProfile: '# Synthetic profile', benchmark, loadResearchPacket: async () => packet })
assert.equal(failed.invalidOrFailed, 1)
assert.equal(failed.results[0].error.status, 429)
assert.equal(failed.results[0].error.message.includes('secret'), false)

let openAiRequest
const openAi = createOpenAiResponsesAdapter({ model: 'synthetic-model', apiKey: 'synthetic-secret', fetchImpl: async (url, options) => { openAiRequest = { url, options }; return { ok: true, json: async () => ({ output_text: JSON.stringify(evaluation), usage: { input_tokens: 5, input_tokens_details: { cached_tokens: 2 }, output_tokens: 3, output_tokens_details: { reasoning_tokens: 1 }, total_tokens: 8 } }) } } })
const openAiResponse = await openAi.evaluate({ prompt: 'Synthetic prompt', outputSchema: { type: 'object' } })
assert.equal(openAiResponse.usage.totalTokens, 8)
assert.equal(openAiResponse.usage.cachedInputTokens, 2)
assert.equal(openAiResponse.usage.reasoningTokens, 1)
assert.equal(openAiRequest.options.body.includes('synthetic-secret'), false)
assert.equal(JSON.parse(openAiRequest.options.body).store, false)

const outputArrayAdapter = createOpenAiResponsesAdapter({ model: 'synthetic-model', apiKey: 'synthetic-secret', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(evaluation) }] }] }) }) })
assert.equal((await outputArrayAdapter.evaluate({ prompt: 'Synthetic prompt', outputSchema: { type: 'object' } })).text.includes('viewer1'), true)

let compatibleRequest
const compatible = createOpenAiCompatibleAdapter({ model: 'synthetic-model', apiKey: 'synthetic-secret', baseUrl: 'https://synthetic.invalid/v1/', fetchImpl: async (url, options) => { compatibleRequest = { url, options }; return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(evaluation) } }] }) } } })
assert.equal((await compatible.evaluate({ prompt: 'Synthetic prompt', outputSchema: { type: 'object' } })).text.includes('viewer1'), true)
assert.equal(compatibleRequest.url, 'https://synthetic.invalid/v1/chat/completions')

const providerFailure = createOpenAiResponsesAdapter({ model: 'synthetic-model', apiKey: 'synthetic-secret', fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { type: 'insufficient_quota', code: 'credit_balance_exhausted' } }) }) })
await assert.rejects(providerFailure.evaluate({ prompt: 'Synthetic prompt', outputSchema: {} }), error => error.status === 429 && error.type === 'insufficient_quota' && error.code === 'credit_balance_exhausted' && !error.message.includes('synthetic-secret'))

const localSecrets = '{"OPENAI_API_KEY":"local-synthetic-secret"}'
assert.equal(await loadLocalCredential({ name: 'OPENAI_API_KEY', environment: { OPENAI_API_KEY: 'environment-synthetic-secret' }, readFile: async () => localSecrets }), 'environment-synthetic-secret')
assert.equal(await loadLocalCredential({ name: 'OPENAI_API_KEY', environment: {}, readFile: async () => localSecrets }), 'local-synthetic-secret')
await assert.rejects(loadLocalCredential({ name: 'OPENAI_API_KEY', environment: {}, readFile: async () => { const error = new Error('not found'); error.code = 'ENOENT'; throw error } }), error => error.message === 'Missing required local credential: OPENAI_API_KEY')
await assert.rejects(loadLocalCredential({ name: 'OPENAI_API_KEY', environment: {}, readFile: async () => '{invalid json' }), error => !error.message.includes('invalid json') && !error.message.includes('secret'))

console.log('LLM evaluator checks passed.')
