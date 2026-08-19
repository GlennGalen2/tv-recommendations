import { PRIVATE_STORES, getPrivateIdentityResolutionReview, listPrivateRecords } from './privateStore.js'
import { evaluateTmdbIdentityRecord } from './tmdbMatchingPilot.js'
import { normalizeNetflixLookupTitle } from './netflixLookupTitle.js'
import { normalizeAmazonLookupTitle } from './amazonLookupTitle.js'

export const CURATED_ANCHOR_LIMIT = 25

const REACTION_PRIORITY = Object.freeze({ loved: 5, liked: 4, okay: 3, disliked: 2, abandoned: 1, unknown: 0 })

function currentReactions(reactions = []) {
  const superseded = new Set(reactions.map(record => record.supersedesReactionId).filter(Boolean))
  return reactions.filter(record => !superseded.has(record.id))
}

function latestResolutions(resolutions = []) {
  const superseded = new Set(resolutions.map(record => record.supersedesResolutionId).filter(Boolean))
  return new Map(resolutions.filter(record => !superseded.has(record.id)).map(record => [record.sourceTitleId, record]))
}

function mediaTypeFor(title) {
  const mediaType = title.curatedReference?.mediaType
  if (mediaType === 'tv') return 'series'
  if (mediaType === 'movie') return 'movie'
  return title.type || 'unknown'
}

function anchorRecord(title, reactions) {
  const sourceTitle = title.curatedReference?.title || title.originalTitle || title.title
  const mediaType = mediaTypeFor(title)
  const lookupNormalization = title.provenance?.sourceId === 'source:netflix'
    ? normalizeNetflixLookupTitle(sourceTitle)
    : title.provenance?.sourceId === 'source:amazon-prime-video'
      ? normalizeAmazonLookupTitle(sourceTitle)
      : {
          searchTitle: sourceTitle,
          applied: false,
          transformation: 'none',
          reason: 'The curated title reference is searched as supplied.',
          mediaTypeHint: null
        }
  const strength = reactions.reduce((sum, reaction) => sum + ((reaction.strength ?? 1) * REACTION_PRIORITY[reaction.reaction]), 0)
  const mechanismCount = reactions.reduce((sum, reaction) => sum
    + (reaction.mechanisms?.positive?.length || 0)
    + (reaction.mechanisms?.negative?.length || 0), 0)

  return {
    title: { ...title, title: lookupNormalization.searchTitle, originalTitle: lookupNormalization.searchTitle, type: lookupNormalization.mediaTypeHint || mediaType },
    events: [],
    sourceTitle,
    searchTitle: lookupNormalization.searchTitle,
    lookupNormalization,
    sourceNames: ['Private curated preference'],
    sourceIds: ['source:manual'],
    playbackEventCount: 0,
    reactions,
    priority: strength * 100 + mechanismCount * 5 + (new Set(reactions.map(reaction => reaction.viewerId)).size > 1 ? 15 : 0)
  }
}

export function selectCuratedPreferenceAnchors({ titles = [], reactions = [] }, limit = CURATED_ANCHOR_LIMIT) {
  const current = currentReactions(reactions)
  const reactionsByTitle = new Map()
  for (const reaction of current) {
    const entries = reactionsByTitle.get(reaction.titleId) || []
    entries.push(reaction)
    reactionsByTitle.set(reaction.titleId, entries)
  }

  return titles
    .filter(title => reactionsByTitle.has(title.id))
    .map(title => anchorRecord(title, reactionsByTitle.get(title.id)))
    .sort((left, right) => right.priority - left.priority
      || left.sourceTitle.localeCompare(right.sourceTitle)
      || left.title.id.localeCompare(right.title.id))
    .slice(0, limit)
}

function persistedItem(record, resolution) {
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
    reactions: record.reactions,
    category,
    state: category,
    bestCandidate: resolution.candidate || null,
    alternateCandidates: [],
    providerCandidateCount: 0,
    typeConflictDetected: false,
    possibleFalseNegative: false,
    searchedMediaTypes: record.title.type === 'unknown' ? ['movie', 'series'] : [record.title.type],
    error: null,
    errorStatus: null,
    resolution
  }
}

function categoryFor(result) {
  return ['review-candidate', 'strong-candidate'].includes(result.state) ? 'needs-review' : 'unresolved'
}

export function summarizeCuratedAnchorResolution(items = []) {
  return items.reduce((summary, item) => {
    summary[item.category] += 1
    if (item.providerCandidateCount === 0 && !item.error && item.category === 'unresolved') summary.noCandidateCases += 1
    if (item.alternateCandidates?.length) summary.ambiguousMatches += 1
    if (item.typeConflictDetected) summary.typeConflicts += 1
    return summary
  }, { 'needs-review': 0, unresolved: 0, confirmed: 0, rejected: 0, 'previously-resolved': 0, noCandidateCases: 0, ambiguousMatches: 0, typeConflicts: 0 })
}

export async function runCuratedAnchorResolutionFromRecords(records, { searchCandidates, limit = CURATED_ANCHOR_LIMIT, onProgress = () => {} } = {}) {
  const selected = selectCuratedPreferenceAnchors(records, limit)
  const latest = latestResolutions(records.resolutions)
  const items = []
  const eligible = selected.filter(record => !latest.has(record.title.id))

  for (let index = 0; index < selected.length; index += 1) {
    const record = selected[index]
    const resolution = latest.get(record.title.id)
    const item = resolution
      ? persistedItem(record, resolution)
      : { ...await evaluateTmdbIdentityRecord(record, searchCandidates), reactions: record.reactions, category: null, resolution: null }
    if (!resolution) item.category = categoryFor(item)
    items.push(item)
    await onProgress({ processed: index + 1, total: selected.length })
  }

  return { items, selectedCount: selected.length, eligibleCount: eligible.length, counts: summarizeCuratedAnchorResolution(items) }
}

export async function runCuratedAnchorResolution(options = {}) {
  const [titles, reactions, review] = await Promise.all([
    listPrivateRecords(PRIVATE_STORES.titles),
    listPrivateRecords(PRIVATE_STORES.reactions),
    getPrivateIdentityResolutionReview()
  ])
  return runCuratedAnchorResolutionFromRecords({ titles, reactions, resolutions: review.resolutions }, options)
}
