import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { loadLocalCredential } from './credentials.js'
import { createOpenAiCompatibleAdapter, createOpenAiResponsesAdapter, createOpenAiWebResearchAdapter } from './providers/openai.js'
import { evaluateCandidate, runBenchmark } from './evaluator.js'
import { evaluateLlmCandidateBatch } from './candidateBatch.js'
import { createHoldoutProfile } from './holdouts.js'
import { writeBenchmarkResult } from './resultStore.js'
import { researchCandidate } from './research.js'
import { writePrivateResearchPacket } from './researchStore.js'
import { createPrivateResearchQueue, privateQueueSummary, runPrivateResearchQueue } from './researchQueue.js'
import { readPrivateResearchQueue, writePrivateResearchQueue } from './researchQueueStore.js'

function args(values) { const result = {}; for (let index = 0; index < values.length; index += 2) if (values[index]?.startsWith('--')) result[values[index].slice(2)] = values[index + 1] || true; return result }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function adapterFrom(config) {
  const apiKey = await loadLocalCredential({ name: config.apiKeyEnv })
  if (config.provider === 'openai') return createOpenAiResponsesAdapter({ model: config.model, apiKey, endpoint: config.endpoint })
  if (config.provider === 'openai-compatible') return createOpenAiCompatibleAdapter({ model: config.model, apiKey, baseUrl: config.baseUrl })
  throw new Error(`Unsupported provider: ${config.provider}`)
}
async function run(config) {
  let profile = await readFile(config.profile, 'utf8'); let benchmark = await json(config.benchmark); const benchmarkDirectory = dirname(resolve(config.benchmark))
  if (config.holdoutManifest || config.holdoutCase) {
    if (!config.holdoutManifest || !config.holdoutCase) throw new Error('Holdout evaluation requires both --holdout-manifest and --holdout-case.')
    const holdout = createHoldoutProfile({ viewerProfile: profile, manifest: await json(config.holdoutManifest), benchmarkCaseId: config.holdoutCase })
    profile = holdout.viewerProfile
    benchmark = { ...benchmark, cases: benchmark.cases.filter(entry => entry.id === config.holdoutCase) }
    if (benchmark.cases.length !== 1) throw new Error('Holdout benchmark case was not found.')
  }
  const report = await runBenchmark({ adapter: await adapterFrom(config), viewerProfile: profile, benchmark, repeats: Number(config.repeats || 1), loadResearchPacket: path => json(resolve(benchmarkDirectory, path)) })
  if (config.resultsDirectory) await writeBenchmarkResult({ report, outputDirectory: config.resultsDirectory })
  console.log(JSON.stringify({ provider: report.provider, model: report.model, cases: report.cases, runs: report.runs, successful: report.successful, invalidOrFailed: report.invalidOrFailed, scoreRangeAccuracy: report.scoreRangeAccuracy, redFlagRecall: report.redFlagRecall, positiveMechanismRecall: report.positiveMechanismRecall, averageLatencyMs: report.averageLatencyMs, tokenUsage: report.tokenUsage, estimatedOrReportedCostUsd: report.estimatedOrReportedCostUsd, majorMisses: report.majorMisses }, null, 2))
}
async function runCandidateBatch(config) {
  const profile = await readFile(config.profile, 'utf8')
  const candidates = await json(config.candidates)
  const researchDirectory = resolve(config.researchDirectory)
  const report = await evaluateLlmCandidateBatch({
    adapter: await adapterFrom(config), viewerProfile: profile, candidateBatch: candidates,
    loadResearchPacket: candidate => json(resolve(researchDirectory, `${candidate.target.mediaType}-${candidate.target.externalId}.json`))
  })
  if (config.resultsDirectory) await writeBenchmarkResult({ report, outputDirectory: config.resultsDirectory })
  console.log(JSON.stringify({ provider: report.provider, model: report.model, evaluations: report.evaluations.length, sourceCandidateBatchId: report.sourceCandidateBatch.id }, null, 2))
}
async function runResearchOne(config) {
  const target = { title: config.title, mediaType: config.mediaType, ...(config.year ? { year: Number(config.year) } : {}) }
  const apiKey = await loadLocalCredential({ name: config.apiKeyEnv })
  const adapter = createOpenAiWebResearchAdapter({ model: config.model, apiKey, endpoint: config.endpoint })
  const result = await researchCandidate({ adapter, target })
  const written = await writePrivateResearchPacket({ packet: result.packet, outputDirectory: config.outputDirectory, filename: config.outputName })
  console.log(JSON.stringify({ title: result.packet.title, mediaType: result.packet.mediaType, sources: result.packet.sources.length, uncertainties: result.packet.uncertainties.length, latencyMs: result.latencyMs, tokenUsage: result.usage, estimatedOrReportedCostUsd: result.costUsd, path: written.path }, null, 2))
}
async function runEvaluationOne(config) {
  const profile = await readFile(config.profile, 'utf8')
  const packet = await json(config.research)
  const result = await evaluateCandidate({ adapter: await adapterFrom(config), viewerProfile: profile, researchPacket: packet })
  console.log(JSON.stringify({
    title: packet.title,
    mediaType: packet.mediaType,
    evaluation: result.evaluation,
    latencyMs: result.latencyMs,
    tokenUsage: result.usage,
    estimatedOrReportedCostUsd: result.costUsd
  }, null, 2))
}
async function createQueue(config) {
  const queue = createPrivateResearchQueue({ candidateBatch: await json(config.candidates), maxCostCents: Number(config.maxCostCents || 100), reservedCostCentsPerCandidate: Number(config.reservedCostCents || 3) })
  const written = await writePrivateResearchQueue({ queue, path: config.queue })
  console.log(JSON.stringify({ queueId: queue.id, queuePath: written.path, ...privateQueueSummary(queue) }, null, 2))
}
async function runQueue(config) {
  const queue = await readPrivateResearchQueue({ path: config.queue })
  const profile = await readFile(config.profile, 'utf8')
  const researchDirectory = resolve(config.researchDirectory || 'llm-eval/private/candidate-research')
  const apiKey = await loadLocalCredential({ name: config.apiKeyEnv })
  const researchModel = config.researchModel || config.model
  const evaluationModel = config.evaluationModel || config.model
  const researchAdapter = createOpenAiWebResearchAdapter({ model: researchModel, apiKey, endpoint: config.endpoint })
  const evaluationAdapter = await adapterFrom({ ...config, model: evaluationModel })
  const result = await runPrivateResearchQueue({
    queue, researchAdapter, evaluationAdapter, viewerProfile: profile,
    loadResearchPacket: async path => { try { return await json(path) } catch { return null } },
    saveResearchPacket: async ({ packet, item }) => (await writePrivateResearchPacket({ packet, outputDirectory: researchDirectory, filename: `${item.target.mediaType}-${item.target.externalId}.json` })).path,
    persistQueue: async value => { await writePrivateResearchQueue({ queue: value, path: config.queue }) },
    retryFailed: config.retryFailed, limit: Number(config.limit || Infinity)
  })
  console.log(JSON.stringify({ queueId: result.queue.id, researchModel, evaluationModel, processed: result.processed, ...result.summary }, null, 2))
}
const [command, ...rest] = process.argv.slice(2); const options = args(rest)
if (command === 'eval') await run({ provider: options.provider, model: options.model, apiKeyEnv: options['api-key-env'] || 'OPENAI_API_KEY', endpoint: options.endpoint, baseUrl: options['base-url'], profile: options.profile || 'llm-eval/templates/viewer-preferences.template.md', benchmark: options.benchmark, repeats: options.repeats, holdoutManifest: options['holdout-manifest'], holdoutCase: options['holdout-case'], resultsDirectory: options['results-dir'] })
else if (command === 'compare') { const config = await json(options.config); for (const entry of config.models || []) await run({ ...entry, profile: entry.profile || config.profile, benchmark: entry.benchmark || config.benchmark, repeats: entry.repeats || config.repeats }) }
else if (command === 'evaluate-candidates') await runCandidateBatch({ provider: options.provider, model: options.model, apiKeyEnv: options['api-key-env'] || 'OPENAI_API_KEY', endpoint: options.endpoint, baseUrl: options['base-url'], profile: options.profile, candidates: options.candidates, researchDirectory: options['research-dir'], resultsDirectory: options['results-dir'] })
else if (command === 'research-one') await runResearchOne({ model: options.model, apiKeyEnv: options['api-key-env'] || 'OPENAI_API_KEY', endpoint: options.endpoint, title: options.title, mediaType: options['media-type'], year: options.year, outputDirectory: options['output-dir'], outputName: options['output-name'] })
else if (command === 'evaluate-one') await runEvaluationOne({ provider: options.provider, model: options.model, apiKeyEnv: options['api-key-env'] || 'OPENAI_API_KEY', endpoint: options.endpoint, baseUrl: options['base-url'], profile: options.profile, research: options.research })
else if (command === 'queue-create') await createQueue({ candidates: options.candidates, queue: options.queue, maxCostCents: options['max-cost-cents'], reservedCostCents: options['reserved-cost-cents'] })
else if (command === 'queue-run') await runQueue({ provider: options.provider, model: options.model, researchModel: options['research-model'], evaluationModel: options['evaluation-model'], apiKeyEnv: options['api-key-env'] || 'OPENAI_API_KEY', endpoint: options.endpoint, baseUrl: options['base-url'], profile: options.profile, queue: options.queue, researchDirectory: options['research-dir'], retryFailed: options['retry-failed'] === 'true', limit: options.limit })
else throw new Error('Usage: npm run llm:eval -- --provider openai --model <model> --benchmark <file>')
