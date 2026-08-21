import { PRIVATE_STORES, getPrivateIdentityResolutionReview, listPrivateRecords, readPrivateMetadata } from './privateStore.js'
import { REACTION_WEIGHTS, jointScore, scoreRecommendationCandidate, traceRecommendationCandidate } from './recommendationEngine.js'
import { fetchTmdbCohortDiscovery, fetchTmdbDiscoveryDetails, fetchTmdbProviderDiscovery, fetchTmdbWatchProviders, fetchTmdbWorkRecommendations } from './tmdbDiscoveryClient.js'
import { normalizeAmazonLookupTitle } from './amazonLookupTitle.js'
import { normalizeNetflixLookupTitle } from './netflixLookupTitle.js'

export const DISCOVERY_SEED_LIMIT = 12
export const DISCOVERY_CANDIDATE_LIMIT = 50
export const DISCOVERY_DETAIL_LIMIT = 25
export const PRIVATE_DISCOVERY_AVAILABILITY_KEY = 'discoveryAvailabilityPreferences'
export const QUALITY_COHORT_CANDIDATE_LIMIT = 120

// These are generic catalog-search recipes, not viewer preferences or taste
// scores. They divide a large provider catalog into interpretable neighborhoods
// so their eventual recommendation yield can be measured independently.
export const QUALITY_DISCOVERY_COHORTS = Object.freeze([
  { id: 'tv-crime-drama', name: 'TV crime drama', mediaType: 'tv', filters: { with_genres: '18,80', without_genres: '16|10762|10764', 'vote_count.gte': '20', 'vote_average.gte': '6.5', sort_by: 'vote_average.desc' } },
  { id: 'tv-mystery-drama', name: 'TV mystery drama', mediaType: 'tv', filters: { with_genres: '18,9648', without_genres: '16|10762|10764', 'vote_count.gte': '20', 'vote_average.gte': '6.5', sort_by: 'vote_average.desc' } },
  { id: 'tv-political-drama', name: 'TV political and institutional drama', mediaType: 'tv', filters: { with_genres: '18,10768', without_genres: '16|10762|10764', 'vote_count.gte': '20', 'vote_average.gte': '6.5', sort_by: 'vote_average.desc' } },
  { id: 'tv-speculative-drama', name: 'TV speculative drama', mediaType: 'tv', filters: { with_genres: '18,10765', without_genres: '16|10762|10764', 'vote_count.gte': '20', 'vote_average.gte': '6.5', sort_by: 'vote_average.desc' } },
  { id: 'movie-historical-drama', name: 'Historical drama films', mediaType: 'movie', filters: { with_genres: '18,36', 'vote_count.gte': '50', 'vote_average.gte': '6.5', sort_by: 'vote_average.desc' } },
  { id: 'movie-acclaimed-drama', name: 'Acclaimed and classic drama films', mediaType: 'movie', filters: { with_genres: '18', 'vote_count.gte': '100', 'vote_average.gte': '7', 'primary_release_date.lte': '2015-12-31', sort_by: 'vote_average.desc' } }
])

export const LONG_TAIL_DISCOVERY_COHORTS = Object.freeze(QUALITY_DISCOVERY_COHORTS.map(cohort => ({
  ...cohort,
  id: `long-tail-${cohort.id}`,
  name: `${cohort.name} — lower exposure`,
  band: 'lower-exposure',
  filters: { ...cohort.filters, 'vote_count.lte': cohort.mediaType === 'movie' ? '1000' : '750' }
})))

const POSITIVE_REACTIONS = new Set(['loved', 'liked'])
const DISCOVERY_SUPPORT_MAXIMUM = 18

function latest(records = [], supersededField) {
  const superseded = new Set(records.map(record => record[supersededField]).filter(Boolean))
  return records.filter(record => !superseded.has(record.id))
}

function mediaType(candidate) { return candidate.mediaType === 'movie' ? 'movie' : 'tv' }
function titleType(candidate) { return mediaType(candidate) === 'movie' ? 'movie' : 'series' }
function candidateKey(candidate) { return `tmdb:${mediaType(candidate)}:${candidate.externalId}` }
function normalizeTitle(value) { return String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ') }
function compatibleTitleType(title, candidate) { return title?.type === 'unknown' || !title?.type || title.type === titleType(candidate) }
function positiveStrength(reaction) { return Math.max(0, REACTION_WEIGHTS[reaction.reaction] || 0) * (reaction.strength ?? 1) }

function lookupTitles(title) {
  const values = [title.title, title.originalTitle].filter(Boolean)
  if (title.provenance?.sourceId === 'source:amazon-prime-video') values.push(normalizeAmazonLookupTitle(title.originalTitle || title.title).searchTitle)
  if (title.provenance?.sourceId === 'source:netflix') values.push(normalizeNetflixLookupTitle(title.originalTitle || title.title).searchTitle)
  return values
}

export function selectDiscoverySeeds({ titles = [], reactions = [], resolutions = [] }, limit = DISCOVERY_SEED_LIMIT) {
  const titlesById = new Map(titles.map(title => [title.id, title]))
  const currentReactions = latest(reactions, 'supersedesReactionId')
  const byTitle = new Map()
  for (const reaction of currentReactions.filter(reaction => POSITIVE_REACTIONS.has(reaction.reaction))) {
    const records = byTitle.get(reaction.titleId) || []
    records.push(reaction)
    byTitle.set(reaction.titleId, records)
  }
  const grouped = new Map()
  for (const resolution of latest(resolutions, 'supersedesResolutionId')) {
    if (resolution.status !== 'manually-confirmed' || resolution.candidate?.provider !== 'tmdb' || !resolution.candidate.externalId) continue
    const reactionsForTitle = byTitle.get(resolution.sourceTitleId) || []
    if (!reactionsForTitle.length) continue
    const key = candidateKey(resolution.candidate)
    const current = grouped.get(key) || { key, provider: 'tmdb', externalId: String(resolution.candidate.externalId), mediaType: mediaType(resolution.candidate), canonicalTitle: resolution.candidate.canonicalTitle, titleIds: [], reactions: [], mechanisms: new Set() }
    current.titleIds.push(resolution.sourceTitleId)
    current.reactions.push(...reactionsForTitle)
    for (const reaction of reactionsForTitle) for (const mechanism of [...(reaction.mechanisms?.positive || []), ...(reaction.mechanisms?.negative || [])]) current.mechanisms.add(mechanism)
    grouped.set(key, current)
  }
  const available = [...grouped.values()].map(seed => ({ ...seed, mechanisms: [...seed.mechanisms].sort(), priority: seed.reactions.reduce((total, reaction) => total + positiveStrength(reaction), 0) + (new Set(seed.reactions.map(reaction => reaction.viewerId)).size > 1 ? 1 : 0) }))
  const selected = []
  const remaining = new Set(available)
  while (selected.length < limit && remaining.size) {
    const next = [...remaining].sort((left, right) => {
      const novelty = seed => seed.mechanisms.filter(mechanism => !selected.some(existing => existing.mechanisms.includes(mechanism))).length * 0.15 + (!selected.some(existing => existing.mediaType === seed.mediaType) ? 0.1 : 0)
      return (right.priority + novelty(right)) - (left.priority + novelty(left)) || left.canonicalTitle.localeCompare(right.canonicalTitle)
    })[0]
    selected.push(next)
    remaining.delete(next)
  }
  return selected
}

function knownCandidateForViewer(candidate, viewerId, records, currentReactions, latestResolutions) {
  const matchedTitleIds = new Set()
  for (const title of records.titles || []) {
    const resolution = latestResolutions.get(title.id)
    const exactCanonical = resolution?.status === 'manually-confirmed' && resolution.candidate?.provider === 'tmdb' && candidateKey(resolution.candidate) === candidateKey(candidate)
    const directCanonical = title.externalIds?.tmdb && String(title.externalIds.tmdb) === String(candidate.externalId) && compatibleTitleType(title, candidate)
    const exactText = compatibleTitleType(title, candidate) && lookupTitles(title).some(value => normalizeTitle(value) === normalizeTitle(candidate.canonicalTitle))
    if (exactCanonical || directCanonical || exactText) matchedTitleIds.add(title.id)
  }
  const watched = (records.events || []).some(event => event.eventType === 'playback' && event.viewerIds?.includes(viewerId) && matchedTitleIds.has(event.titleId))
  const rated = currentReactions.some(reaction => reaction.viewerId === viewerId && matchedTitleIds.has(reaction.titleId))
  return { watched, rated, excluded: watched || rated }
}

export function applyDiscoveryExclusions(candidates, records) {
  const currentReactions = latest(records.reactions, 'supersedesReactionId')
  const latestResolutions = new Map(latest(records.resolutions, 'supersedesResolutionId').map(record => [record.sourceTitleId, record]))
  return candidates.map(candidate => ({
    ...candidate,
    exclusions: Object.fromEntries(['viewer-1', 'viewer-2'].map(viewerId => [viewerId, knownCandidateForViewer(candidate, viewerId, records, currentReactions, latestResolutions)]))
  }))
}

function addCandidate(map, candidate, seed = null, availabilitySource = null) {
  const key = candidateKey(candidate)
  const current = map.get(key) || { ...candidate, id: `discovery:${key}`, discoverySeeds: [] }
  if (seed && !current.discoverySeeds.some(existing => existing.key === seed.key)) {
    current.discoverySeeds.push({ key: seed.key, canonicalTitle: seed.canonicalTitle, mediaType: seed.mediaType, externalId: seed.externalId, reactions: seed.reactions.map(reaction => ({ viewerId: reaction.viewerId, reaction: reaction.reaction, strength: reaction.strength ?? 1 })) })
  }
  if (availabilitySource) {
    current.discoverySources ||= []
    const sourceKey = source => source.kind === 'tmdb-quality-cohort' ? `${source.kind}:${source.providerGroup || 'all'}:${source.cohortId}` : `${source.kind}:${source.mediaType}:${source.providerId}`
    if (!current.discoverySources.some(source => sourceKey(source) === sourceKey(availabilitySource))) current.discoverySources.push(availabilitySource)
  }
  map.set(key, current)
}

function supportFor(candidate, viewerId) {
  const support = candidate.discoverySeeds.reduce((total, seed) => {
    const direct = seed.reactions.filter(reaction => reaction.viewerId === viewerId)
    const sharedFallback = viewerId === 'viewer-2' && !direct.length ? seed.reactions.filter(reaction => reaction.viewerId === 'viewer-1') : direct
    return total + sharedFallback.reduce((sum, reaction) => sum + positiveStrength(reaction), 0)
  }, 0)
  return Math.min(1, support / 1.5)
}

function scoreDiscoveredCandidate(candidate, records) {
  const scoreInput = { title: candidate, titles: records.titles, events: records.events, reactions: records.reactions, resolutions: records.resolutions, candidateEvidence: records.candidateEvidence }
  const oneBase = scoreRecommendationCandidate({ ...scoreInput, viewerId: 'viewer-1', otherViewerId: 'viewer-2' })
  const twoBase = scoreRecommendationCandidate({ ...scoreInput, viewerId: 'viewer-2', otherViewerId: 'viewer-1' })
  const oneTrace = traceRecommendationCandidate({ ...scoreInput, viewerId: 'viewer-1', otherViewerId: 'viewer-2' })
  const twoTrace = traceRecommendationCandidate({ ...scoreInput, viewerId: 'viewer-2', otherViewerId: 'viewer-1' })
  const scoreFor = base => {
    const support = supportFor(candidate, base.viewerId)
    const sources = candidate.discoverySeeds.filter(seed => seed.reactions.some(reaction => reaction.viewerId === base.viewerId)).map(seed => seed.canonicalTitle)
    const increment = Math.round(support * DISCOVERY_SUPPORT_MAXIMUM)
    const trace = base.viewerId === 'viewer-1' ? oneTrace.trace : twoTrace.trace
    return {
      ...base,
      score: Math.min(100, base.score + increment),
      confidence: Math.max(base.confidence, support ? 0.28 : base.confidence),
      reasons: support ? [`TMDb recommended it from ${sources.length} confirmed positive anchor${sources.length === 1 ? '' : 's'}: ${sources.slice(0, 2).join(', ')}.`, ...base.reasons].slice(0, 3) : base.reasons,
      discoverySupport: support,
      trace: { ...trace, discoveryContribution: increment, engineScore: base.score, finalScore: Math.min(100, base.score + increment) }
    }
  }
  const viewerOne = scoreFor(oneBase)
  const viewerTwo = scoreFor(twoBase)
  const joint = jointScore(viewerOne, viewerTwo)
  const researchPriority = discoveryResearchPriority(candidate)
  return { ...candidate, discoveryPriority: researchPriority.value, discoveryPriorityReasons: researchPriority.reasons, viewerScores: [viewerOne, viewerTwo], joint, explanation: [...viewerOne.reasons, ...viewerTwo.reasons].slice(0, 3) }
}

function candidatePriority(candidate) {
  return candidate.discoverySeeds.reduce((total, seed) => total + seed.reactions.reduce((sum, reaction) => sum + positiveStrength(reaction), 0), 0)
}

export function discoveryResearchPriority(candidate) {
  const cohortSources = candidate.discoverySources?.filter(source => source.kind === 'tmdb-quality-cohort') || []
  const cohortCount = new Set(cohortSources.map(source => source.cohortId)).size
  const prioritySource = cohortSources.some(source => source.providerGroup === 'priority')
  const votes = Math.max(0, Number(candidate.voteCount) || 0)
  const rating = Math.max(0, Math.min(10, Number(candidate.voteAverage) || 0))
  const priorMean = 6.8
  const priorWeight = 250
  const credibleRating = ((votes * rating) + (priorWeight * priorMean)) / (votes + priorWeight)
  const crossCohortBonus = Math.min(12, Math.max(0, cohortCount - 1) * 6)
  const curatedSourceBonus = prioritySource ? 5 : 0
  const credibilityBonus = Math.min(8, Math.log10(votes + 1) * 2)
  return {
    value: Math.round((credibleRating * 8) + crossCohortBonus + curatedSourceBonus + credibilityBonus),
    reasons: [
      cohortCount > 1 ? `Caught independently by ${cohortCount} catalog neighborhoods.` : cohortCount === 1 ? 'Caught by one catalog neighborhood.' : null,
      prioritySource ? 'Available through the priority curated-service group.' : cohortSources.length ? 'Retained as broader-service exploration.' : null,
      votes ? `TMDb rating evidence is ${rating.toFixed(1)} from ${votes} vote${votes === 1 ? '' : 's'}, conservatively shrunk for research triage.` : 'No TMDb vote evidence; quality remains uncertain.'
    ].filter(Boolean)
  }
}

function candidateOrder(left, right) {
  return candidatePriority(right) - candidatePriority(left)
    || (right.discoverySources?.length || 0) - (left.discoverySources?.length || 0)
    || discoveryResearchPriority(right).value - discoveryResearchPriority(left).value
    || left.canonicalTitle.localeCompare(right.canonicalTitle)
}

// Availability affects which titles are examined, not their taste score. When
// preferred-service candidates exist, reserve up to half of the bounded pool
// for them so anchor recommendations cannot crowd them out before scoring.
function selectBoundedCandidates(candidates, limit) {
  const availabilityCandidates = candidates.filter(candidate => candidate.discoverySources?.length)
  if (!availabilityCandidates.length) return candidates.sort(candidateOrder).slice(0, limit)
  const availabilityBudget = Math.min(availabilityCandidates.length, Math.ceil(limit / 2))
  const selected = availabilityCandidates.sort(candidateOrder).slice(0, availabilityBudget)
  const selectedKeys = new Set(selected.map(candidateKey))
  for (const candidate of candidates.sort(candidateOrder)) {
    if (selected.length >= limit) break
    if (!selectedKeys.has(candidateKey(candidate))) {
      selected.push(candidate)
      selectedKeys.add(candidateKey(candidate))
    }
  }
  return selected
}

function safeError(error, stage, seed = null) {
  const status = error?.status || null
  const message = status === 401 ? 'TMDb rejected the configured read token.'
    : status === 403 ? 'TMDb denied access for the configured read token.'
      : status === 429 ? 'TMDb rate-limited discovery; retry later.'
        : 'TMDb discovery was unavailable (network or browser restriction).'
  return { stage, seedKey: seed?.key || null, status, message }
}

async function bounded(items, maximum, work, onProgress) {
  const results = []
  let cursor = 0
  let halted = false
  async function worker() {
    while (!halted) {
      const index = cursor++
      if (index >= items.length) return
      const item = items[index]
      try { results[index] = { item, value: await work(item) } }
      catch (error) {
        results[index] = { item, error }
        if (error?.status === 429) halted = true
      }
      await onProgress({ processed: Math.min(cursor, items.length), total: items.length, halted })
    }
  }
  await Promise.all(Array.from({ length: Math.min(maximum, items.length) }, worker))
  return { results: results.filter(Boolean), halted }
}

export async function runTmdbDiscoveryFromRecords(records, {
  fetchRecommendations = fetchTmdbWorkRecommendations,
  fetchDetails = fetchTmdbDiscoveryDetails,
  onProgress = () => {},
  seedLimit = DISCOVERY_SEED_LIMIT,
  candidateLimit = DISCOVERY_CANDIDATE_LIMIT,
  detailLimit = DISCOVERY_DETAIL_LIMIT,
  concurrency = 2,
  providerCandidates = []
} = {}) {
  const seeds = selectDiscoverySeeds(records, seedLimit)
  const recommendationRun = await bounded(seeds, Math.min(2, Math.max(1, concurrency)), seed => fetchRecommendations({ seed }), progress => onProgress({ stage: 'discovering', ...progress }))
  const errors = recommendationRun.results.filter(result => result.error).map(result => safeError(result.error, 'recommendations', result.item))
  const candidatesByKey = new Map()
  for (const result of recommendationRun.results) if (result.value) for (const candidate of result.value) addCandidate(candidatesByKey, candidate, result.item)
  for (const entry of providerCandidates) {
    for (const candidate of entry.candidates || []) addCandidate(candidatesByKey, candidate, null, entry.source)
  }
  const excluded = applyDiscoveryExclusions([...candidatesByKey.values()], records)
  const candidates = selectBoundedCandidates(
    excluded.filter(candidate => !candidate.exclusions['viewer-1'].excluded || !candidate.exclusions['viewer-2'].excluded),
    candidateLimit
  )
  const detailTargets = candidates.slice(0, detailLimit)
  const detailRun = await bounded(detailTargets, Math.min(2, Math.max(1, concurrency)), candidate => fetchDetails({ candidate }), progress => onProgress({ stage: 'enriching', ...progress }))
  errors.push(...detailRun.results.filter(result => result.error).map(result => safeError(result.error, 'details')))
  const detailsByKey = new Map(detailRun.results.filter(result => result.value).map(result => [candidateKey(result.item), result.value]))
  const enriched = candidates.map(candidate => detailsByKey.get(candidateKey(candidate)) ? { ...detailsByKey.get(candidateKey(candidate)), id: candidate.id, discoverySeeds: candidate.discoverySeeds, discoverySources: candidate.discoverySources || [], exclusions: candidate.exclusions } : candidate)
  const scored = enriched.map(candidate => scoreDiscoveredCandidate(candidate, records))
  const forViewer = viewerId => scored.filter(candidate => !candidate.exclusions[viewerId].excluded).sort((left, right) => right.viewerScores.find(score => score.viewerId === viewerId).score - left.viewerScores.find(score => score.viewerId === viewerId).score || right.discoveryPriority - left.discoveryPriority || left.canonicalTitle.localeCompare(right.canonicalTitle))
  const joint = scored.filter(candidate => !candidate.exclusions['viewer-1'].excluded && !candidate.exclusions['viewer-2'].excluded).sort((left, right) => right.joint.value - left.joint.value || right.discoveryPriority - left.discoveryPriority || left.canonicalTitle.localeCompare(right.canonicalTitle))
  return {
    generated: true, persisted: false, seeds, candidates: scored,
    candidateCounts: { 'viewer-1': forViewer('viewer-1').length, 'viewer-2': forViewer('viewer-2').length, joint: joint.length },
    viewerOne: forViewer('viewer-1'), viewerTwo: forViewer('viewer-2'), joint,
    errors, halted: recommendationRun.halted || detailRun.halted,
    haltedReason: (recommendationRun.halted || detailRun.halted) ? 'TMDb rate-limited discovery. Retry later; no private data was changed.' : null
  }
}

function cleanAvailabilityPreferences(value) {
  const region = /^[A-Za-z]{2}$/.test(value?.region || '') ? value.region.toUpperCase() : 'US'
  const serviceNames = [...new Set((value?.serviceNames || []).map(name => String(name).trim()).filter(Boolean))]
  const priorityServiceNames = [...new Set((value?.priorityServiceNames || []).map(name => String(name).trim()).filter(Boolean))]
  return { region, serviceNames, priorityServiceNames }
}

export async function resolveTmdbPreferredServices(preferences, { fetchProviders = fetchTmdbWatchProviders } = {}) {
  const settings = cleanAvailabilityPreferences(preferences)
  const [tvProviders, movieProviders] = await Promise.all([
    fetchProviders({ mediaType: 'tv', region: settings.region }),
    fetchProviders({ mediaType: 'movie', region: settings.region })
  ])
  const names = new Set(settings.serviceNames.map(normalizeTitle))
  const priorityNames = new Set(settings.priorityServiceNames.map(normalizeTitle))
  const select = (providers, mediaType) => providers.filter(provider => names.has(normalizeTitle(provider.name))).map(provider => ({ ...provider, mediaType }))
  const selectedProviders = [...select(tvProviders, 'tv'), ...select(movieProviders, 'movie')]
  return {
    ...settings,
    selectedProviders,
    selectedPriorityProviders: selectedProviders.filter(provider => priorityNames.has(normalizeTitle(provider.name))),
    unmatchedServiceNames: settings.serviceNames.filter(name => ![...tvProviders, ...movieProviders].some(provider => normalizeTitle(provider.name) === normalizeTitle(name))),
    unmatchedPriorityServiceNames: settings.priorityServiceNames.filter(name => ![...tvProviders, ...movieProviders].some(provider => normalizeTitle(provider.name) === normalizeTitle(name)))
  }
}

export async function runTmdbPreferredServiceDiscovery(records, preferences, {
  fetchProviders = fetchTmdbWatchProviders,
  fetchProviderDiscovery = fetchTmdbProviderDiscovery,
  providerOnly = false,
  ...options
} = {}) {
  const resolved = await resolveTmdbPreferredServices(preferences, { fetchProviders })
  const providerRun = await bounded(resolved.selectedProviders, 2, async provider => ({
    source: { kind: 'tmdb-watch-provider', providerId: provider.id, providerName: provider.name, mediaType: provider.mediaType, region: resolved.region, attribution: 'Watch availability data provided by JustWatch.' },
    candidates: await fetchProviderDiscovery({ mediaType: provider.mediaType, providerIds: [provider.id], region: resolved.region, page: 1 })
  }), () => {})
  if (providerRun.halted) throw Object.assign(new Error('TMDb rate-limited preferred-service discovery.'), { status: 429 })
  const providerCandidates = providerRun.results.filter(result => result.value).map(result => result.value)
  const result = await runTmdbDiscoveryFromRecords(records, { ...options, ...(providerOnly ? { seedLimit: 0 } : {}), providerCandidates })
  return { ...result, availability: { ...resolved, providerOnly, attribution: 'Watch availability data provided by JustWatch.' } }
}

export async function runTmdbQualityCohortDiscovery(records, preferences, {
  cohorts = QUALITY_DISCOVERY_COHORTS,
  fetchProviders = fetchTmdbWatchProviders,
  fetchCohortDiscovery = fetchTmdbCohortDiscovery,
  pageNumbers = null,
  ...options
} = {}) {
  const resolved = await resolveTmdbPreferredServices(preferences, { fetchProviders })
  const priorityKeys = new Set(resolved.selectedPriorityProviders.map(provider => `${provider.mediaType}:${provider.id}`))
  const explorationProviders = resolved.selectedProviders.filter(provider => !priorityKeys.has(`${provider.mediaType}:${provider.id}`))
  const providerGroups = resolved.selectedPriorityProviders.length ? [
    { id: 'priority', name: 'Priority curated services', providers: resolved.selectedPriorityProviders, perCohortLimit: 15 },
    ...(explorationProviders.length ? [{ id: 'exploration', name: 'Broader-service exploration', providers: explorationProviders, perCohortLimit: 5 }] : [])
  ] : [{ id: 'all', name: 'All preferred services', providers: resolved.selectedProviders, perCohortLimit: 20 }]
  const requestedPages = Array.isArray(pageNumbers)
    ? [...new Set(pageNumbers.filter(page => Number.isInteger(page) && page >= 1))]
    : null
  const pagesFor = cohort => requestedPages?.length
    ? requestedPages
    : cohort.band === 'lower-exposure' ? [1, 2] : [1]
  const searchItems = providerGroups.flatMap(group => cohorts
    .filter(cohort => group.providers.some(provider => provider.mediaType === cohort.mediaType))
    .flatMap(cohort => pagesFor(cohort).map(page => ({ cohort, group, page, providerIds: group.providers.filter(provider => provider.mediaType === cohort.mediaType).map(provider => provider.id) }))))
  const cohortRun = await bounded(searchItems, 2, async item => ({
    source: {
      kind: 'tmdb-quality-cohort', cohortId: item.cohort.id, cohortName: item.cohort.name,
      discoveryBand: item.cohort.band || 'established',
      providerGroup: item.group.id, providerGroupName: item.group.name,
      mediaType: item.cohort.mediaType, region: resolved.region,
      providerIds: item.providerIds,
      attribution: 'Watch availability data provided by JustWatch.'
    },
    candidates: (await fetchCohortDiscovery({ cohort: item.cohort, providerIds: item.providerIds, region: resolved.region, page: item.page })).slice(0, item.group.perCohortLimit)
  }), () => {})
  if (cohortRun.halted) throw Object.assign(new Error('TMDb rate-limited quality-cohort discovery.'), { status: 429 })
  const providerCandidates = cohortRun.results.filter(result => result.value).map(result => result.value)
  const result = await runTmdbDiscoveryFromRecords(records, {
    ...options, seedLimit: 0, candidateLimit: options.candidateLimit || QUALITY_COHORT_CANDIDATE_LIMIT,
    providerCandidates
  })
  const cohortCounts = cohorts.map(cohort => ({
    id: cohort.id, name: cohort.name,
    sourceCandidates: providerCandidates.filter(entry => entry.source.cohortId === cohort.id).reduce((total, entry) => total + entry.candidates.length, 0),
    retainedCandidates: result.candidates.filter(candidate => candidate.discoverySources?.some(source => source.cohortId === cohort.id)).length
  })).filter(cohort => cohort.sourceCandidates)
  const providerGroupCounts = providerGroups.map(group => ({
    id: group.id, name: group.name,
    sourceCandidates: providerCandidates.filter(entry => entry.source.providerGroup === group.id).reduce((total, entry) => total + entry.candidates.length, 0),
    retainedCandidates: result.candidates.filter(candidate => candidate.discoverySources?.some(source => source.providerGroup === group.id)).length
  }))
  return {
    ...result,
    qualityPilot: {
      cohorts: cohortCounts,
      providerGroups: providerGroupCounts,
      multiCohortCandidates: result.candidates.filter(candidate => new Set(candidate.discoverySources?.filter(source => source.kind === 'tmdb-quality-cohort').map(source => source.cohortId)).size > 1).length,
      sourceCandidates: cohortCounts.reduce((total, cohort) => total + cohort.sourceCandidates, 0)
    },
    availability: { ...resolved, providerOnly: true, attribution: 'Watch availability data provided by JustWatch.' }
  }
}

export async function runTmdbDiscovery({ listRecords = listPrivateRecords, getIdentityReview = getPrivateIdentityResolutionReview, ...options } = {}) {
  const [titles, events, reactions, review, candidateEvidence] = await Promise.all([
    listRecords(PRIVATE_STORES.titles), listRecords(PRIVATE_STORES.historyEvents),
    listRecords(PRIVATE_STORES.reactions), getIdentityReview(), listRecords(PRIVATE_STORES.candidateEvidence)
  ])
  return runTmdbDiscoveryFromRecords({ titles, events, reactions, resolutions: review.resolutions, candidateEvidence }, options)
}

export async function runTmdbPreferredServiceDiscoveryFromPrivateStore({ listRecords = listPrivateRecords, getIdentityReview = getPrivateIdentityResolutionReview, readMetadata = readPrivateMetadata, ...options } = {}) {
  const [titles, events, reactions, review, candidateEvidence, preferencesRecord] = await Promise.all([
    listRecords(PRIVATE_STORES.titles), listRecords(PRIVATE_STORES.historyEvents), listRecords(PRIVATE_STORES.reactions), getIdentityReview(), listRecords(PRIVATE_STORES.candidateEvidence), readMetadata(PRIVATE_DISCOVERY_AVAILABILITY_KEY)
  ])
  return runTmdbPreferredServiceDiscovery({ titles, events, reactions, resolutions: review.resolutions, candidateEvidence }, preferencesRecord?.value || {}, options)
}

export async function runTmdbQualityCohortDiscoveryFromPrivateStore({ listRecords = listPrivateRecords, getIdentityReview = getPrivateIdentityResolutionReview, readMetadata = readPrivateMetadata, ...options } = {}) {
  const [titles, events, reactions, review, candidateEvidence, preferencesRecord] = await Promise.all([
    listRecords(PRIVATE_STORES.titles), listRecords(PRIVATE_STORES.historyEvents), listRecords(PRIVATE_STORES.reactions), getIdentityReview(), listRecords(PRIVATE_STORES.candidateEvidence), readMetadata(PRIVATE_DISCOVERY_AVAILABILITY_KEY)
  ])
  return runTmdbQualityCohortDiscovery({ titles, events, reactions, resolutions: review.resolutions, candidateEvidence }, preferencesRecord?.value || {}, options)
}
