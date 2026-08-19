import { PRIVATE_STORES, getPrivateIdentityResolutionReview, listPrivateRecords } from './privateStore.js'
import {
  confidenceTier,
  createIdentityMatchQuery,
  rankIdentityCandidates
} from './identityMatching.js'
import { searchTmdbCandidates } from './tmdbClient.js'
import { normalizeAmazonLookupTitle } from './amazonLookupTitle.js'

function titleRecord(title, events, sourcesById) {
  const titleEvents = events.filter(event => event.titleId === title.id && event.eventType === 'playback')
  const sourceIds = [...new Set(titleEvents.map(event => event.provenance?.sourceId).filter(Boolean))]
  const sourceNames = sourceIds.map(sourceId => sourcesById.get(sourceId)?.name || sourceId).sort()
  const sourceTitle = titleEvents.find(event => event.observations?.sourceTitle)?.observations?.sourceTitle
    || title.originalTitle || title.title
  const isAmazon = sourceIds.includes('source:amazon-prime-video')
  const lookupNormalization = isAmazon
    ? normalizeAmazonLookupTitle(sourceTitle)
    : { searchTitle: title.type === 'unknown' ? sourceTitle : title.title, applied: false, transformation: 'none', reason: 'Non-Amazon source titles are not changed by Amazon lookup normalization.', mediaTypeHint: null }

  return {
    title,
    events: titleEvents,
    sourceTitle,
    searchTitle: lookupNormalization.searchTitle,
    lookupNormalization,
    sourceNames,
    sourceIds,
    playbackEventCount: titleEvents.length,
    ambiguous: title.type === 'unknown' && /[:()\-–—]/.test(sourceTitle),
    hasEpisodeStructure: titleEvents.some(event => event.mediaScope?.level === 'episode'),
    genericName: /^[\p{L}\p{N}]+(?:\s+[\p{L}\p{N}]+)?$/u.test(title.title) && title.title.length <= 16
  }
}

function ranked(records) {
  return [...records].sort((left, right) =>
    right.playbackEventCount - left.playbackEventCount
    || left.sourceTitle.localeCompare(right.sourceTitle)
    || left.title.id.localeCompare(right.title.id)
  )
}

export function selectTmdbPilotTitles({ titles = [], events = [], sources = [] }) {
  const sourcesById = new Map(sources.map(source => [source.id, source]))
  const records = titles.map(title => titleRecord(title, events, sourcesById)).filter(record => record.events.length)
  const selected = []
  const add = record => {
    if (record && !selected.some(item => item.title.id === record.title.id) && selected.length < 10) selected.push(record)
  }
  const from = (filter, count) => ranked(records.filter(filter)).slice(0, count).forEach(add)

  from(record => record.sourceIds.length > 1, 1)
  from(record => record.ambiguous, 1)
  from(record => record.title.type === 'movie', 3)
  from(record => record.title.type === 'series', 3)
  from(record => record.title.type === 'unknown' && record.sourceIds.includes('source:amazon-prime-video'), 3)
  ranked(records).forEach(add)

  return selected.slice(0, 10)
}

export function selectTmdbEvaluationTitles({ titles = [], events = [], sources = [] }, limit = 50) {
  const sourcesById = new Map(sources.map(source => [source.id, source]))
  const records = titles.map(title => titleRecord(title, events, sourcesById)).filter(record => record.events.length)
  const selected = []
  const add = record => {
    if (record && !selected.some(item => item.title.id === record.title.id) && selected.length < limit) selected.push(record)
  }
  const from = (filter, count) => ranked(records.filter(filter)).slice(0, count).forEach(add)
  const quotas = limit >= 200
    ? { crossSource: 20, ambiguous: 25, episodes: 40, generic: 25, normalizedAmazon: 30, movies: 40, series: 40, unresolvedAmazon: 60 }
    : { crossSource: 5, ambiguous: 5, episodes: 8, generic: 6, normalizedAmazon: 10, movies: 10, series: 10, unresolvedAmazon: 10 }

  from(record => record.sourceIds.length > 1, quotas.crossSource)
  from(record => record.ambiguous, quotas.ambiguous)
  from(record => record.hasEpisodeStructure, quotas.episodes)
  from(record => record.genericName, quotas.generic)
  from(record => record.lookupNormalization.applied, quotas.normalizedAmazon)
  from(record => record.title.type === 'movie', quotas.movies)
  from(record => record.title.type === 'series', quotas.series)
  from(record => record.title.type === 'unknown' && record.sourceIds.includes('source:amazon-prime-video'), quotas.unresolvedAmazon)
  ranked(records).forEach(add)

  return selected.slice(0, limit)
}

function mediaTypesFor(record) {
  if (record.lookupNormalization.mediaTypeHint) return [record.lookupNormalization.mediaTypeHint]
  if (record.title.type === 'movie') return ['movie']
  if (record.title.type === 'series') return ['series']
  return ['movie', 'series']
}

function resultState(bestCandidate) {
  if (!bestCandidate) return 'unresolved'
  if (confidenceTier(bestCandidate.score) === 'automatic-eligible') return 'strong-candidate'
  if (confidenceTier(bestCandidate.score) === 'review-required') return 'review-candidate'
  return 'unresolved'
}

function safeSearchError(error) {
  if (error?.status === 401) return 'TMDb rejected the configured read token.'
  if (error?.status === 403) return 'TMDb denied access for the configured read token.'
  if (error?.status === 429) return 'TMDb rate-limited the pilot search.'
  return 'TMDb search was unavailable (network or browser restriction).'
}

function pause(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function latestResolutionsByTitle(resolutions = []) {
  const superseded = new Set(resolutions.map(record => record.supersedesResolutionId).filter(Boolean))
  return new Map(resolutions.filter(record => !superseded.has(record.id)).map(record => [record.sourceTitleId, record]))
}

function persistedQueueItem(record, resolution) {
  const category = resolution.status === 'manually-confirmed'
    ? 'confirmed'
    : resolution.status === 'manually-rejected'
      ? 'rejected'
      : 'previously-resolved'
  return {
    titleId: record.title.id,
    sourceTitle: record.sourceTitle,
    sourceNames: record.sourceNames,
    sourceIds: record.sourceIds,
    existingType: record.title.type,
    searchTitle: record.searchTitle,
    lookupNormalization: record.lookupNormalization,
    category,
    state: category,
    bestCandidate: resolution.candidate || null,
    alternateCandidates: [],
    providerCandidateCount: 0,
    typeConflictDetected: false,
    possibleFalseNegative: false,
    searchedMediaTypes: mediaTypesFor(record),
    error: null,
    resolution
  }
}

function categoryForResult(result) {
  return result.state === 'review-candidate' || result.state === 'strong-candidate'
    ? 'needs-review'
    : 'unresolved'
}

export function summarizeIdentityReviewQueue(items) {
  return items.reduce((counts, item) => {
    counts[item.category] += 1
    if (item.lookupNormalization.applied) counts.normalizedLookups += 1
    if (item.providerCandidateCount === 0 && !item.error && ['needs-review', 'unresolved'].includes(item.category)) counts.noCandidateCases += 1
    if (item.alternateCandidates.length) counts.sameNameAmbiguityCases += 1
    if (item.typeConflictDetected) counts.typeConflicts += 1
    if (item.possibleFalseNegative) counts.possibleFalseNegatives += 1
    if (item.sourceIds.length > 1) counts.crossSourceTitles += 1
    return counts
  }, {
    'needs-review': 0,
    unresolved: 0,
    confirmed: 0,
    rejected: 0,
    'previously-resolved': 0,
    normalizedLookups: 0,
    noCandidateCases: 0,
    sameNameAmbiguityCases: 0,
    typeConflicts: 0,
    possibleFalseNegatives: 0,
    crossSourceTitles: 0
  })
}

export function filterAndSortIdentityReviewQueue(items, { category = 'all', sort = 'priority' } = {}) {
  const filtered = items.filter(item => category === 'all' || item.category === category)
  return [...filtered].sort((left, right) => {
    if (sort === 'title') return left.sourceTitle.localeCompare(right.sourceTitle) || left.titleId.localeCompare(right.titleId)
    if (sort === 'confidence') return (right.bestCandidate?.score || 0) - (left.bestCandidate?.score || 0) || left.sourceTitle.localeCompare(right.sourceTitle)
    const priority = { 'needs-review': 0, unresolved: 1, confirmed: 2, rejected: 3, 'previously-resolved': 4 }
    return priority[left.category] - priority[right.category]
      || (right.bestCandidate?.score || 0) - (left.bestCandidate?.score || 0)
      || left.sourceTitle.localeCompare(right.sourceTitle)
  })
}

export function paginateIdentityReviewQueue(items, page = 0, pageSize = 10) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(Math.max(page, 0), pageCount - 1)
  return { page: safePage, pageCount, items: items.slice(safePage * pageSize, (safePage + 1) * pageSize) }
}

function normalizeTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function summarizeEvaluation(results) {
  const confidenceDistribution = {
    noScore: 0,
    belowReview: 0,
    review75To84: 0,
    high85To99: 0,
    automaticEligible: 0
  }
  let noCandidateCases = 0
  let sameNameAmbiguityCases = 0
  let typeConflicts = 0
  let possibleFalseNegatives = 0
  let crossSourceTitles = 0

  for (const result of results) {
    if (result.providerCandidateCount === 0 && !result.error) noCandidateCases += 1
    if (result.alternateCandidates.length) sameNameAmbiguityCases += 1
    if (result.typeConflictDetected) typeConflicts += 1
    if (result.possibleFalseNegative) possibleFalseNegatives += 1
    if (result.sourceIds.length > 1) crossSourceTitles += 1
    const score = result.bestCandidate?.score
    if (score === undefined) confidenceDistribution.noScore += 1
    else if (score < 0.75) confidenceDistribution.belowReview += 1
    else if (score < 0.85) confidenceDistribution.review75To84 += 1
    else if (score < 0.995) confidenceDistribution.high85To99 += 1
    else confidenceDistribution.automaticEligible += 1
  }

  const normalization = results.reduce((counts, result) => {
    if (result.lookupNormalization.applied) {
      counts.normalizedLookups += 1
      if (result.providerCandidateCount > 0) counts.normalizedLookupsWithCandidates += 1
      if (result.state === 'review-candidate' || result.state === 'strong-candidate') counts.normalizedLookupsWithReviewCandidate += 1
    }
    return counts
  }, { normalizedLookups: 0, normalizedLookupsWithCandidates: 0, normalizedLookupsWithReviewCandidate: 0 })

  return {
    distribution: results.reduce((counts, result) => {
      counts[result.state] += 1
      return counts
    }, { 'strong-candidate': 0, 'review-candidate': 0, unresolved: 0 }),
    noCandidateCases,
    sameNameAmbiguityCases,
    typeConflicts,
    obviousFalsePositives: 0,
    possibleFalseNegatives,
    crossSourceTitles,
    normalization,
    confidenceDistribution
  }
}

export async function evaluateTmdbIdentityRecord(record, searchCandidates = searchTmdbCandidates) {
  const lookupTitle = { ...record.title, title: record.searchTitle, originalTitle: record.searchTitle, type: record.lookupNormalization.mediaTypeHint || record.title.type }
  const query = createIdentityMatchQuery(lookupTitle, record.events)
  try {
    const candidates = await searchCandidates({ query: record.searchTitle, mediaTypes: mediaTypesFor(record) })
    const rankedCandidates = rankIdentityCandidates(query, candidates)
    const exactNameCandidates = candidates.filter(candidate => normalizeTitle(candidate.canonicalTitle) === normalizeTitle(record.searchTitle))
    return {
      titleId: record.title.id, sourceTitle: record.sourceTitle, sourceNames: record.sourceNames, sourceIds: record.sourceIds,
      existingType: record.title.type, searchTitle: record.searchTitle, lookupNormalization: record.lookupNormalization,
      state: resultState(rankedCandidates[0]), bestCandidate: rankedCandidates[0] || null, alternateCandidates: rankedCandidates.slice(1, 3),
      providerCandidateCount: candidates.length,
      typeConflictDetected: Boolean(query.mediaTypeHint && exactNameCandidates.some(candidate => candidate.mediaType !== query.mediaTypeHint)),
      possibleFalseNegative: rankedCandidates.length > 0 && rankedCandidates[0].score < 0.75,
      searchedMediaTypes: mediaTypesFor(record), error: null, errorStatus: null
    }
  } catch (error) {
    return {
      titleId: record.title.id, sourceTitle: record.sourceTitle, sourceNames: record.sourceNames, sourceIds: record.sourceIds,
      existingType: record.title.type, searchTitle: record.searchTitle, lookupNormalization: record.lookupNormalization,
      state: 'unresolved', bestCandidate: null, alternateCandidates: [], providerCandidateCount: 0,
      typeConflictDetected: false, possibleFalseNegative: false, searchedMediaTypes: mediaTypesFor(record), error: safeSearchError(error), errorStatus: error?.status || null
    }
  }
}

export async function runTmdbMatchingEvaluationFromRecords(records, {
  limit = 10,
  selection = limit === 10 ? selectTmdbPilotTitles : selectTmdbEvaluationTitles,
  searchCandidates = searchTmdbCandidates
} = {}) {
  const selected = selection(records, limit)
  if (selected.length !== limit) throw new Error(`The private title collection does not contain ${limit} playback title records.`)

  const results = []
  for (const record of selected) {
    results.push(await evaluateTmdbIdentityRecord(record, searchCandidates))
  }

  return { results, ...summarizeEvaluation(results) }
}

export async function runTmdbIdentityReviewQueueFromRecords(records, {
  searchCandidates = searchTmdbCandidates,
  onProgress = () => {},
  throttleMs = 75,
  eligibleTitleIds = null,
  previousItems = []
} = {}) {
  const sourcesById = new Map((records.sources || []).map(source => [source.id, source]))
  const titleRecords = (records.titles || []).map(title => titleRecord(title, records.events || [], sourcesById)).filter(record => record.events.length)
  const latest = latestResolutionsByTitle(records.resolutions || [])
  const allowed = eligibleTitleIds ? new Set(eligibleTitleIds) : null
  const persistentItems = titleRecords.filter(record => latest.has(record.title.id)).map(record => persistedQueueItem(record, latest.get(record.title.id)))
  const eligible = titleRecords.filter(record => !latest.has(record.title.id) && (!allowed || allowed.has(record.title.id)))
  const matchedItems = []
  let pendingTitleIds = []
  let haltedReason = null

  for (let index = 0; index < eligible.length; index += 1) {
    if (index > 0 && throttleMs > 0) await pause(throttleMs)
    const result = await evaluateTmdbIdentityRecord(eligible[index], searchCandidates)
    if (result.errorStatus === 429) {
      pendingTitleIds = eligible.slice(index).map(record => record.title.id)
      haltedReason = 'TMDb rate-limited the queue. Retry the remaining records later.'
      await onProgress({ processed: index, total: eligible.length, halted: true })
      break
    }
    matchedItems.push({ ...result, category: categoryForResult(result), resolution: null })
    if (index === eligible.length - 1 || index % 5 === 4) await onProgress({ processed: index + 1, total: eligible.length, halted: false })
  }

  const itemsByTitle = new Map(previousItems.map(item => [item.titleId, item]))
  for (const item of persistentItems) itemsByTitle.set(item.titleId, item)
  for (const item of matchedItems) itemsByTitle.set(item.titleId, item)
  const items = [...itemsByTitle.values()]
  return {
    items,
    counts: summarizeIdentityReviewQueue(items),
    eligibleCount: eligible.length,
    processedCount: matchedItems.length,
    pendingTitleIds,
    haltedReason
  }
}

export async function runTmdbMatchingPilotFromRecords(records, options = {}) {
  return runTmdbMatchingEvaluationFromRecords(records, { ...options, limit: 10 })
}

export async function runTmdbMatchingPilot() {
  const [titles, events, sources] = await Promise.all([
    listPrivateRecords(PRIVATE_STORES.titles),
    listPrivateRecords(PRIVATE_STORES.historyEvents),
    listPrivateRecords(PRIVATE_STORES.sources)
  ])
  return runTmdbMatchingPilotFromRecords({ titles, events, sources })
}

export async function runTmdbMatchingEvaluation(limit = 50) {
  const [titles, events, sources] = await Promise.all([
    listPrivateRecords(PRIVATE_STORES.titles),
    listPrivateRecords(PRIVATE_STORES.historyEvents),
    listPrivateRecords(PRIVATE_STORES.sources)
  ])
  return runTmdbMatchingEvaluationFromRecords({ titles, events, sources }, { limit })
}

export async function runTmdbIdentityReviewQueue(options = {}) {
  const [titles, events, sources, review] = await Promise.all([
    listPrivateRecords(PRIVATE_STORES.titles),
    listPrivateRecords(PRIVATE_STORES.historyEvents),
    listPrivateRecords(PRIVATE_STORES.sources),
    getPrivateIdentityResolutionReview()
  ])
  return runTmdbIdentityReviewQueueFromRecords({ titles, events, sources, resolutions: review.resolutions }, options)
}
