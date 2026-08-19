import { PRIVATE_STORES, listPrivateRecords } from './privateStore.js'
import {
  confidenceTier,
  createIdentityMatchQuery,
  rankIdentityCandidates
} from './identityMatching.js'
import { searchTmdbCandidates } from './tmdbClient.js'

function titleRecord(title, events, sourcesById) {
  const titleEvents = events.filter(event => event.titleId === title.id && event.eventType === 'playback')
  const sourceIds = [...new Set(titleEvents.map(event => event.provenance?.sourceId).filter(Boolean))]
  const sourceNames = sourceIds.map(sourceId => sourcesById.get(sourceId)?.name || sourceId).sort()
  const sourceTitle = titleEvents.find(event => event.observations?.sourceTitle)?.observations?.sourceTitle
    || title.originalTitle || title.title

  return {
    title,
    events: titleEvents,
    sourceTitle,
    searchTitle: title.type === 'unknown' ? sourceTitle : title.title,
    sourceNames,
    sourceIds,
    playbackEventCount: titleEvents.length,
    ambiguous: title.type === 'unknown' && /:/.test(sourceTitle)
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

function mediaTypesFor(record) {
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

export async function runTmdbMatchingPilotFromRecords(records, { searchCandidates = searchTmdbCandidates } = {}) {
  const selected = selectTmdbPilotTitles(records)
  if (selected.length !== 10) throw new Error('The private title collection does not contain ten playback title records.')

  const results = []
  for (const record of selected) {
    const query = createIdentityMatchQuery(record.title, record.events)
    try {
      const candidates = await searchCandidates({
        query: record.searchTitle,
        mediaTypes: mediaTypesFor(record)
      })
      const rankedCandidates = rankIdentityCandidates(query, candidates)
      results.push({
        titleId: record.title.id,
        sourceTitle: record.sourceTitle,
        sourceNames: record.sourceNames,
        existingType: record.title.type,
        state: resultState(rankedCandidates[0]),
        bestCandidate: rankedCandidates[0] || null,
        alternateCandidates: rankedCandidates.slice(1, 3),
        searchedMediaTypes: mediaTypesFor(record),
        error: null
      })
    } catch (error) {
      results.push({
        titleId: record.title.id,
        sourceTitle: record.sourceTitle,
        sourceNames: record.sourceNames,
        existingType: record.title.type,
        state: 'unresolved',
        bestCandidate: null,
        alternateCandidates: [],
        searchedMediaTypes: mediaTypesFor(record),
        error: safeSearchError(error)
      })
    }
  }

  return {
    results,
    distribution: results.reduce((counts, result) => {
      counts[result.state] += 1
      return counts
    }, { 'strong-candidate': 0, 'review-candidate': 0, unresolved: 0 })
  }
}

export async function runTmdbMatchingPilot() {
  const [titles, events, sources] = await Promise.all([
    listPrivateRecords(PRIVATE_STORES.titles),
    listPrivateRecords(PRIVATE_STORES.historyEvents),
    listPrivateRecords(PRIVATE_STORES.sources)
  ])
  return runTmdbMatchingPilotFromRecords({ titles, events, sources })
}
