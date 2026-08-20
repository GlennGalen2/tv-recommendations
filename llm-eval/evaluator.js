const REQUIRED_VIEWER_FIELDS = ['fitScore', 'confidence', 'positiveFactors', 'negativeFactors', 'redFlags', 'positiveMechanismTags', 'negativeMechanismTags', 'redFlagTags', 'rationale']
const REQUIRED_JOINT_FIELDS = ['fitScore', 'confidence', 'keyAgreementFactors', 'keyDisagreementFactors', 'rationale']

export const CANONICAL_MECHANISM_TAGS = Object.freeze([
  'broad-caricature', 'character-ensemble', 'coherent-speculative-mystery', 'community', 'competing-agendas', 'credible-espionage', 'credible-professional-behavior', 'criminal-protagonist', 'evolving-information', 'extreme-suspense', 'fourth-wall-device', 'historical-authenticity', 'implausible-workplace-behavior', 'intelligent-plotting', 'intelligent-science-fiction', 'interesting-aliens', 'investigation', 'moral-complexity', 'moral-identification-risk', 'natural-dialogue', 'relationships', 'rootable-characters', 'speculative-mystery', 'speculative-worldbuilding', 'subtextual-dialogue', 'visual-imagination-effects', 'world-building'
])

export const EVALUATOR_OUTPUT_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['viewer1', 'viewer2', 'joint'], properties: {
    viewer1: { $ref: '#/$defs/viewer' }, viewer2: { $ref: '#/$defs/viewer' }, joint: { $ref: '#/$defs/joint' }
  }, $defs: {
    viewer: { type: 'object', additionalProperties: false, required: REQUIRED_VIEWER_FIELDS, properties: { fitScore: { type: 'integer', minimum: 0, maximum: 100 }, confidence: { type: 'number', minimum: 0, maximum: 1 }, positiveFactors: { type: 'array', items: { type: 'string' } }, negativeFactors: { type: 'array', items: { type: 'string' } }, redFlags: { type: 'array', items: { type: 'string' } }, positiveMechanismTags: { $ref: '#/$defs/mechanismTags' }, negativeMechanismTags: { $ref: '#/$defs/mechanismTags' }, redFlagTags: { $ref: '#/$defs/mechanismTags' }, rationale: { type: 'string', minLength: 1 } } },
    mechanismTags: { type: 'array', items: { type: 'string', enum: CANONICAL_MECHANISM_TAGS } },
    joint: { type: 'object', additionalProperties: false, required: REQUIRED_JOINT_FIELDS, properties: { fitScore: { type: 'integer', minimum: 0, maximum: 100 }, confidence: { type: 'number', minimum: 0, maximum: 1 }, keyAgreementFactors: { type: 'array', items: { type: 'string' } }, keyDisagreementFactors: { type: 'array', items: { type: 'string' } }, rationale: { type: 'string', minLength: 1 } } }
  }
})

function requireObject(value, name) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`) }
function rejectUnknownFields(value, allowed, name) { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`${name}.${key} is not allowed.`) }
function requireScore(value, name) { if (!Number.isInteger(value) || value < 0 || value > 100) throw new TypeError(`${name} must be an integer from 0 through 100.`) }
function requireConfidence(value, name) { if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError(`${name} must be a number from 0 through 1.`) }
function requireStrings(value, name) { if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new TypeError(`${name} must be an array of strings.`) }
function requireMechanismTags(value, name) { requireStrings(value, name); if (new Set(value).size !== value.length || value.some(tag => !CANONICAL_MECHANISM_TAGS.includes(tag))) throw new TypeError(`${name} must contain unique canonical mechanism tags.`) }

function validateViewer(value, name) {
  requireObject(value, name)
  rejectUnknownFields(value, REQUIRED_VIEWER_FIELDS, name)
  for (const field of REQUIRED_VIEWER_FIELDS) if (!(field in value)) throw new TypeError(`${name}.${field} is required.`)
  requireScore(value.fitScore, `${name}.fitScore`); requireConfidence(value.confidence, `${name}.confidence`)
  for (const field of ['positiveFactors', 'negativeFactors', 'redFlags']) requireStrings(value[field], `${name}.${field}`)
  for (const field of ['positiveMechanismTags', 'negativeMechanismTags', 'redFlagTags']) requireMechanismTags(value[field], `${name}.${field}`)
  if (typeof value.rationale !== 'string' || !value.rationale.trim()) throw new TypeError(`${name}.rationale must be a non-empty string.`)
}

function validateJoint(value) {
  requireObject(value, 'joint')
  rejectUnknownFields(value, REQUIRED_JOINT_FIELDS, 'joint')
  for (const field of REQUIRED_JOINT_FIELDS) if (!(field in value)) throw new TypeError(`joint.${field} is required.`)
  requireScore(value.fitScore, 'joint.fitScore'); requireConfidence(value.confidence, 'joint.confidence')
  for (const field of ['keyAgreementFactors', 'keyDisagreementFactors']) requireStrings(value[field], `joint.${field}`)
  if (typeof value.rationale !== 'string' || !value.rationale.trim()) throw new TypeError('joint.rationale must be a non-empty string.')
}

export function validateEvaluationOutput(value) {
  requireObject(value, 'Evaluation output')
  rejectUnknownFields(value, ['viewer1', 'viewer2', 'joint'], 'Evaluation output')
  validateViewer(value.viewer1, 'viewer1'); validateViewer(value.viewer2, 'viewer2'); validateJoint(value.joint)
  return value
}

export function parseEvaluationOutput(text) {
  if (typeof text !== 'string') throw new TypeError('Evaluator output must be JSON text.')
  let parsed
  try { parsed = JSON.parse(text) } catch { const error = new TypeError('Evaluator output was not valid JSON.'); error.type = 'json_parse_failed'; throw error }
  try { return validateEvaluationOutput(parsed) } catch (error) { error.type = 'local_schema_validation_failed'; throw error }
}

export function validateResearchPacket(packet) {
  requireObject(packet, 'Research packet')
  if (typeof packet.title !== 'string' || !packet.title.trim()) throw new TypeError('Research packet requires a title.')
  if (!['movie', 'tv'].includes(packet.mediaType)) throw new TypeError('Research packet requires mediaType movie or tv.')
  if (packet.year !== undefined && (!Number.isInteger(packet.year) || packet.year < 1888)) throw new TypeError('Research packet year must be an integer when supplied.')
  if (packet.sources !== undefined && (!Array.isArray(packet.sources) || packet.sources.some(source => !source || typeof source !== 'object' || typeof source.provider !== 'string'))) throw new TypeError('Research packet sources must be provenance objects when supplied.')
  return packet
}

export function buildEvaluatorPrompt({ viewerProfile, researchPacket }) {
  if (typeof viewerProfile !== 'string' || !viewerProfile.trim()) throw new TypeError('A non-empty viewer profile Markdown file is required.')
  validateResearchPacket(researchPacket)
  return `You are a careful qualitative TV/movie recommendation evaluator. Use only the supplied viewer profile and candidate research packet. Do not infer missing traits. Do not use genre or similarity alone. Viewing/completion is not an explicit preference. Distinguish depiction from endorsement: a criminal protagonist is not automatically disqualifying when the story condemns the behavior or includes accountability/moral development. Assess rootability, motives, harm to innocents, endorsement/accountability, dialogue, professional realism, tone, violence/torture/gore, mystery/coherence, speculative imagination, visual execution, stylistic devices, and viewer-specific differences. Do not treat an imaginative scientific premise or speculative physics as implausible professional behavior; professional realism concerns how people and institutions behave. When supported by the research packet, credit intelligent science fiction, coherent speculative world-building, interesting aliens, and visual imagination/effects according to the supplied viewer profile. Keep positiveFactors, negativeFactors, redFlags, and rationales as natural-language explanations. In each viewer result, add canonical tags only when the evidence clearly supports the exact concept; leave a tag array empty rather than choosing a merely related tag. Positive mechanism tags must describe positive fit evidence; do not place an appealing mechanism in a negative tag array merely because its execution has a separate weakness. Allowed canonical mechanism tags: ${CANONICAL_MECHANISM_TAGS.join(', ')}. Return JSON only, exactly matching the requested output contract.\n\n# Viewer preference profile\n${viewerProfile}\n\n# Candidate research packet\n${JSON.stringify(researchPacket, null, 2)}`
}

function normalized(value) { return String(value || '').trim().toLocaleLowerCase() }
function recall(expected = [], actual = []) {
  if (!expected.length) return { matched: 0, expected: 0, recall: 1, missing: [] }
  const actualValues = new Set(actual.map(normalized))
  const missing = expected.filter(item => !actualValues.has(normalized(item)))
  return { matched: expected.length - missing.length, expected: expected.length, recall: (expected.length - missing.length) / expected.length, missing }
}

function rangeResult(score, range = []) { return Array.isArray(range) && range.length === 2 && score >= range[0] && score <= range[1] }

function safeProviderFailureMessage(error) {
  if (error?.code === 'credit_balance_exhausted') return 'OpenAI API credit balance is exhausted.'
  if (error?.status === 429) return 'OpenAI provider rate limited the request.'
  if (error?.status === 401 || error?.status === 403) return 'OpenAI authentication or authorization failed.'
  if (error?.type === 'response_extraction_failed') return 'OpenAI response did not contain output text.'
  return 'LLM provider request failed.'
}

export function scoreBenchmarkCase(benchmarkCase, evaluation) {
  validateEvaluationOutput(evaluation)
  const expected = benchmarkCase.expected || {}
  const ranges = { viewer1: rangeResult(evaluation.viewer1.fitScore, expected.viewer1Range), viewer2: rangeResult(evaluation.viewer2.fitScore, expected.viewer2Range), joint: rangeResult(evaluation.joint.fitScore, expected.jointRange) }
  const redFlags = recall(expected.redFlags, [...evaluation.viewer1.redFlagTags, ...evaluation.viewer2.redFlagTags])
  const positiveMechanisms = recall(expected.positiveMechanisms, [...evaluation.viewer1.positiveMechanismTags, ...evaluation.viewer2.positiveMechanismTags])
  return { ranges, scoreRangeAccuracy: Object.values(ranges).filter(Boolean).length / 3, redFlags, positiveMechanisms, majorMiss: !Object.values(ranges).every(Boolean) || redFlags.missing.length > 0 || positiveMechanisms.missing.length > 0 }
}

export async function evaluateCandidate({ adapter, viewerProfile, researchPacket }) {
  if (!adapter || typeof adapter.evaluate !== 'function') throw new TypeError('An evaluator provider adapter is required.')
  const startedAt = performance.now()
  let response
  try { response = await adapter.evaluate({ prompt: buildEvaluatorPrompt({ viewerProfile, researchPacket }), outputSchema: EVALUATOR_OUTPUT_SCHEMA }) }
  catch (error) { const safe = new Error(safeProviderFailureMessage(error)); safe.status = error?.status || null; safe.type = error?.type || 'provider_request_failed'; safe.code = error?.code || null; throw safe }
  let evaluation
  try { evaluation = parseEvaluationOutput(response?.text) }
  catch (error) { const safe = new Error(error?.message || 'Evaluator output validation failed.'); safe.status = null; safe.type = error?.type || 'local_schema_validation_failed'; safe.code = null; throw safe }
  return { evaluation, latencyMs: Math.round(performance.now() - startedAt), usage: response?.usage || null, costUsd: Number.isFinite(response?.costUsd) ? response.costUsd : null }
}

export async function runBenchmark({ adapter, viewerProfile, benchmark, loadResearchPacket, repeats = 1 }) {
  if (!benchmark || !Array.isArray(benchmark.cases)) throw new TypeError('Benchmark requires a cases array.')
  if (!Number.isInteger(repeats) || repeats < 1) throw new TypeError('repeats must be a positive integer.')
  const results = []
  for (const benchmarkCase of benchmark.cases) for (let run = 1; run <= repeats; run += 1) {
    const packet = await loadResearchPacket(benchmarkCase.researchPacket)
    try {
      const response = await evaluateCandidate({ adapter, viewerProfile, researchPacket: packet })
      let score
      try { score = scoreBenchmarkCase(benchmarkCase, response.evaluation) }
      catch (error) { const safe = new Error('Benchmark scoring failed.'); safe.status = null; safe.type = 'benchmark_scoring_failed'; safe.code = null; throw safe }
      results.push({ id: benchmarkCase.id, run, ...response, score })
    } catch (error) { results.push({ id: benchmarkCase.id, run, error: { status: error?.status || null, type: error?.type || 'unknown_failure', code: error?.code || null, message: error?.message || 'Benchmark evaluation failed.' } }) }
  }
  const successful = results.filter(result => !result.error)
  const average = field => successful.length ? successful.reduce((sum, result) => sum + field(result), 0) / successful.length : 0
  const tokenUsage = successful.reduce((total, result) => ({ inputTokens: total.inputTokens + (result.usage?.inputTokens || 0), cachedInputTokens: total.cachedInputTokens + (result.usage?.cachedInputTokens || 0), outputTokens: total.outputTokens + (result.usage?.outputTokens || 0), reasoningTokens: total.reasoningTokens + (result.usage?.reasoningTokens || 0), totalTokens: total.totalTokens + (result.usage?.totalTokens || 0) }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 })
  const byCase = new Map()
  for (const result of successful) {
    const values = byCase.get(result.id) || []
    values.push(`${result.evaluation.viewer1.fitScore}:${result.evaluation.viewer2.fitScore}:${result.evaluation.joint.fitScore}`)
    byCase.set(result.id, values)
  }
  const consistency = repeats > 1 && byCase.size ? [...byCase.values()].reduce((sum, values) => sum + (new Set(values).size === 1 && values.length === repeats ? 1 : 0), 0) / byCase.size : null
  return { provider: adapter.id, model: adapter.model, cases: benchmark.cases.length, runs: results.length, successful: successful.length, invalidOrFailed: results.length - successful.length, scoreRangeAccuracy: average(result => result.score.scoreRangeAccuracy), redFlagRecall: average(result => result.score.redFlags.recall), positiveMechanismRecall: average(result => result.score.positiveMechanisms.recall), averageLatencyMs: average(result => result.latencyMs), tokenUsage, estimatedOrReportedCostUsd: successful.reduce((sum, result) => sum + (result.costUsd || 0), 0), consistency, majorMisses: successful.filter(result => result.score.majorMiss).map(result => result.id), results }
}

export async function compareModels({ adapters, viewerProfile, benchmark, loadResearchPacket, repeats = 1 }) {
  if (!Array.isArray(adapters) || !adapters.length) throw new TypeError('At least one provider adapter is required.')
  return Promise.all(adapters.map(adapter => runBenchmark({ adapter, viewerProfile, benchmark, loadResearchPacket, repeats })))
}
