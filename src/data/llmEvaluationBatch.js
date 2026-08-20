export const LLM_CANDIDATE_BATCH_FORMAT = 'tv-recommendations-llm-candidate-batch'
export const LLM_EVALUATION_BATCH_FORMAT = 'tv-recommendations-llm-evaluation-batch'
export const LLM_BATCH_FORMAT_VERSION = 1
const TARGET_TYPES = new Set(['movie', 'tv'])

function requireObject(value, message) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(message) }
function requireText(value, message) { if (typeof value !== 'string' || !value.trim()) throw new TypeError(message) }
function requireTarget(target) {
  requireObject(target, 'Each LLM candidate requires a target.')
  if (target.provider !== 'tmdb' || !TARGET_TYPES.has(target.mediaType)) throw new TypeError('Each LLM candidate requires a TMDb movie or TV target.')
  requireText(target.externalId, 'Each LLM candidate requires a stable TMDb ID.')
  requireText(target.canonicalTitle, 'Each LLM candidate requires a canonical title.')
}

function stableCandidate(candidate) {
  return {
    target: {
      provider: 'tmdb', mediaType: candidate.mediaType, externalId: String(candidate.externalId), canonicalTitle: candidate.canonicalTitle,
      releaseYear: Number.isInteger(candidate.releaseYear) ? candidate.releaseYear : null
    },
    overview: typeof candidate.overview === 'string' ? candidate.overview : null,
    genreNames: Array.isArray(candidate.genreNames) ? candidate.genreNames.filter(value => typeof value === 'string') : [],
    discoveryPriority: Number.isInteger(candidate.discoveryPriority) ? candidate.discoveryPriority : null,
    discoveryPriorityReasons: Array.isArray(candidate.discoveryPriorityReasons) ? candidate.discoveryPriorityReasons.filter(value => typeof value === 'string') : [],
    discoverySeeds: Array.isArray(candidate.discoverySeeds) ? candidate.discoverySeeds.map(seed => ({
      provider: 'tmdb', mediaType: seed.mediaType, externalId: String(seed.externalId), canonicalTitle: seed.canonicalTitle
    })) : [],
    discoverySources: Array.isArray(candidate.discoverySources) ? candidate.discoverySources.map(source => source.kind === 'tmdb-quality-cohort' ? {
      kind: source.kind, cohortId: source.cohortId, cohortName: source.cohortName,
      ...(source.providerGroup ? { providerGroup: source.providerGroup, providerGroupName: source.providerGroupName } : {}),
      ...(source.discoveryBand ? { discoveryBand: source.discoveryBand } : {}),
      mediaType: source.mediaType, region: source.region
    } : {
      kind: source.kind, providerId: String(source.providerId), providerName: source.providerName,
      mediaType: source.mediaType, region: source.region
    }) : []
  }
}

function takeBalanced(candidates, limit, selected, selectedKeys) {
  const cohortIds = [...new Set(candidates.flatMap(candidate => (candidate.discoverySources || []).filter(source => source.kind === 'tmdb-quality-cohort').map(source => source.cohortId)).filter(Boolean))]
  const key = candidate => `${candidate.mediaType}:${candidate.externalId}`
  const target = selected.length + limit
  while (selected.length < target && cohortIds.length) {
    let added = false
    for (const cohortId of cohortIds) {
      if (selected.length >= target) break
      const candidate = candidates.find(item => !selectedKeys.has(key(item)) && item.discoverySources?.some(source => source.kind === 'tmdb-quality-cohort' && source.cohortId === cohortId))
      if (!candidate) continue
      selected.push(candidate)
      selectedKeys.add(key(candidate))
      added = true
    }
    if (!added) break
  }
}

function balancedCandidateSelection(candidates, limit) {
  const selected = []
  const selectedKeys = new Set()
  const key = candidate => `${candidate.mediaType}:${candidate.externalId}`
  const priority = candidates.filter(candidate => candidate.discoverySources?.some(source => source.providerGroup === 'priority'))
  const exploration = candidates.filter(candidate => !candidate.discoverySources?.some(source => source.providerGroup === 'priority') && candidate.discoverySources?.some(source => source.providerGroup === 'exploration'))
  if (priority.length && exploration.length) {
    const priorityBudget = Math.min(priority.length, Math.ceil(limit * 0.75))
    takeBalanced(priority, priorityBudget, selected, selectedKeys)
    takeBalanced(exploration, Math.min(exploration.length, limit - selected.length), selected, selectedKeys)
  } else {
    takeBalanced(candidates, limit, selected, selectedKeys)
  }
  for (const candidate of candidates) {
    if (selected.length >= limit) break
    if (!selectedKeys.has(key(candidate))) {
      selected.push(candidate)
      selectedKeys.add(key(candidate))
    }
  }
  return selected
}

export function llmEvaluatedTargetKeys(records = []) {
  return new Set(records
    .filter(record => record?.kind === 'llm-evaluation-batch')
    .flatMap(record => record.llmEvaluationBatch?.evaluations || [])
    .map(entry => entry?.target)
    .filter(target => target?.provider === 'tmdb' && TARGET_TYPES.has(target.mediaType) && target.externalId !== null && target.externalId !== undefined)
    .map(target => `${target.provider}:${target.mediaType}:${target.externalId}`))
}

export function unevaluatedLlmCandidates(candidates, evaluationRecords = []) {
  const evaluated = llmEvaluatedTargetKeys(evaluationRecords)
  return candidates.filter(candidate => !evaluated.has(`tmdb:${candidate.mediaType}:${candidate.externalId}`))
}

export function createLlmCandidateBatch(candidates, { id, createdAt = new Date().toISOString(), limit = 15, evaluationRecords = [] } = {}) {
  if (!Array.isArray(candidates)) throw new TypeError('LLM candidate export requires candidates.')
  const selected = balancedCandidateSelection(unevaluatedLlmCandidates(candidates, evaluationRecords), limit).map(stableCandidate)
  const batch = {
    format: LLM_CANDIDATE_BATCH_FORMAT,
    formatVersion: LLM_BATCH_FORMAT_VERSION,
    id: id || `llm-candidates-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`,
    createdAt,
    candidates: selected
  }
  return validateLlmCandidateBatch(batch)
}

export function validateLlmCandidateBatch(batch) {
  requireObject(batch, 'LLM candidate batch must be an object.')
  if (batch.format !== LLM_CANDIDATE_BATCH_FORMAT || batch.formatVersion !== LLM_BATCH_FORMAT_VERSION) throw new TypeError('Unsupported LLM candidate batch format.')
  requireText(batch.id, 'LLM candidate batch requires an ID.')
  if (typeof batch.createdAt !== 'string' || Number.isNaN(Date.parse(batch.createdAt))) throw new TypeError('LLM candidate batch requires a valid creation timestamp.')
  if (!Array.isArray(batch.candidates) || !batch.candidates.length || batch.candidates.length > 20) throw new TypeError('LLM candidate batches require 1 through 20 candidates.')
  const keys = new Set()
  for (const candidate of batch.candidates) {
    requireObject(candidate, 'Each LLM candidate must be an object.')
    requireTarget(candidate.target)
    const key = `${candidate.target.provider}:${candidate.target.mediaType}:${candidate.target.externalId}`
    if (keys.has(key)) throw new TypeError('LLM candidate batches cannot repeat a TMDb target.')
    keys.add(key)
  }
  return batch
}

function requireEvaluation(value) {
  requireObject(value, 'Each LLM evaluation must be an object.')
  for (const viewer of ['viewer1', 'viewer2']) {
    const result = value[viewer]
    requireObject(result, `LLM evaluation ${viewer} is required.`)
    if (!Number.isInteger(result.fitScore) || result.fitScore < 0 || result.fitScore > 100 || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) throw new TypeError(`LLM evaluation ${viewer} has an invalid score or confidence.`)
  }
  requireObject(value.joint, 'LLM evaluation joint result is required.')
  if (!Number.isInteger(value.joint.fitScore) || value.joint.fitScore < 0 || value.joint.fitScore > 100 || !Number.isFinite(value.joint.confidence) || value.joint.confidence < 0 || value.joint.confidence > 1) throw new TypeError('LLM evaluation joint result has an invalid score or confidence.')
}

export function validateLlmEvaluationBatch(batch) {
  requireObject(batch, 'LLM evaluation batch must be an object.')
  if (batch.format !== LLM_EVALUATION_BATCH_FORMAT || batch.formatVersion !== LLM_BATCH_FORMAT_VERSION) throw new TypeError('Unsupported LLM evaluation batch format.')
  requireText(batch.id, 'LLM evaluation batch requires an ID.')
  requireText(batch.provider, 'LLM evaluation batch requires a provider.')
  requireText(batch.model, 'LLM evaluation batch requires a model.')
  if (typeof batch.generatedAt !== 'string' || Number.isNaN(Date.parse(batch.generatedAt))) throw new TypeError('LLM evaluation batch requires a valid generatedAt timestamp.')
  requireObject(batch.sourceCandidateBatch, 'LLM evaluation batch requires source candidate provenance.')
  requireText(batch.sourceCandidateBatch.id, 'LLM evaluation batch requires its source candidate batch ID.')
  if (!Array.isArray(batch.evaluations) || !batch.evaluations.length || batch.evaluations.length > 20) throw new TypeError('LLM evaluation batches require 1 through 20 evaluations.')
  for (const entry of batch.evaluations) {
    requireObject(entry, 'Each LLM evaluation entry must be an object.')
    requireTarget(entry.target)
    requireEvaluation(entry.evaluation)
  }
  return batch
}

export function previewLlmEvaluationBatchImport(jsonText, existingRecords = []) {
  try {
    const parsed = JSON.parse(jsonText)
    const batch = validateLlmEvaluationBatch(parsed.report || parsed)
    const duplicate = existingRecords.some(record => record.kind === 'llm-evaluation-batch' && record.llmEvaluationBatch?.id === batch.id)
    return { batch, importable: !duplicate, duplicate, problem: duplicate ? 'This private evaluation batch has already been imported.' : null }
  } catch {
    return { batch: null, importable: false, duplicate: false, problem: 'The selected file is not a valid private LLM evaluation batch.' }
  }
}
