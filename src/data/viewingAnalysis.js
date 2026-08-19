function normalizeIdentity(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function eventDate(event) {
  return event.occurredOn || event.occurredAt?.slice(0, 10) || null
}

function sourceTitleFor(event, title) {
  return event.observations?.sourceTitle || title?.originalTitle || title?.title || event.titleId
}

function createSummary({ id, title, sourceId, sourceName, unresolved }) {
  return {
    id,
    canonicalTitle: title?.title || null,
    titleType: title?.type || 'unknown',
    identityConfidence: unresolved ? 'unresolved-source-record' : 'exact-title-and-type',
    titleIds: new Set(),
    sourceIds: new Set(),
    services: new Set(),
    sourceTitles: new Set(),
    eventIds: new Set(),
    firstViewed: null,
    mostRecentViewed: null,
    distinctEpisodes: new Set(),
    seasons: new Set(),
    playbackEventCount: 0,
    sourceId,
    sourceName
  }
}

function addEvent(summary, event, title, sourceName) {
  const date = eventDate(event)
  const scope = event.mediaScope || {}
  summary.titleIds.add(event.titleId)
  summary.sourceIds.add(event.provenance?.sourceId || 'source:unknown')
  summary.services.add(sourceName)
  summary.sourceTitles.add(sourceTitleFor(event, title))
  summary.eventIds.add(event.id)
  summary.playbackEventCount += 1

  if (date && (!summary.firstViewed || date < summary.firstViewed)) summary.firstViewed = date
  if (date && (!summary.mostRecentViewed || date > summary.mostRecentViewed)) summary.mostRecentViewed = date
  if (scope.level === 'episode' && Number.isFinite(scope.episodeNumber)) {
    summary.distinctEpisodes.add(`${scope.seasonNumber ?? 'unknown'}:${scope.episodeNumber}`)
  }
  if (Number.isFinite(scope.seasonNumber)) summary.seasons.add(scope.seasonNumber)
}

function finalizeSummary(summary) {
  const distinctEpisodeCount = summary.distinctEpisodes.size
  const knownUnits = distinctEpisodeCount || (summary.titleType === 'movie' ? 1 : 0)
  const repeatPlaybackDetected = knownUnits > 0 && summary.playbackEventCount > knownUnits

  return {
    id: summary.id,
    canonicalTitle: summary.canonicalTitle,
    titleType: summary.titleType,
    identityConfidence: summary.identityConfidence,
    titleIds: [...summary.titleIds].sort(),
    sourceIds: [...summary.sourceIds].sort(),
    services: [...summary.services].sort(),
    sourceTitles: [...summary.sourceTitles].sort(),
    firstViewed: summary.firstViewed,
    mostRecentViewed: summary.mostRecentViewed,
    playbackEventCount: summary.playbackEventCount,
    distinctEpisodeCount,
    seasonsRepresented: [...summary.seasons].sort((a, b) => a - b),
    repeatPlaybackDetected,
    repeatPlaybackCount: repeatPlaybackDetected ? summary.playbackEventCount - knownUnits : 0
  }
}

export function deriveViewingAnalysis({ events = [], titles = [], sources = [] }) {
  const titlesById = new Map(titles.map(title => [title.id, title]))
  const sourceNames = new Map(sources.map(source => [source.id, source.name || source.id]))
  const summariesByKey = new Map()
  const sourceEventCounts = {}
  const dates = []

  for (const event of events) {
    if (event.eventType !== 'playback') continue

    const title = titlesById.get(event.titleId)
    const sourceId = event.provenance?.sourceId || 'source:unknown'
    const sourceName = sourceNames.get(sourceId) || sourceId
    const normalizedTitle = normalizeIdentity(title?.title)
    const reliablyResolved = (title?.type === 'movie' || title?.type === 'series') && normalizedTitle
    const key = reliablyResolved
      ? `resolved:${title.type}:${normalizedTitle}`
      : `unresolved:${sourceId}:${event.titleId}`
    const summary = summariesByKey.get(key)
      || createSummary({ id: key, title, sourceId, sourceName, unresolved: !reliablyResolved })

    summariesByKey.set(key, summary)
    addEvent(summary, event, title, sourceName)
    sourceEventCounts[sourceName] = (sourceEventCounts[sourceName] || 0) + 1
    const date = eventDate(event)
    if (date) dates.push(date)
  }

  const summaries = [...summariesByKey.values()]
    .map(finalizeSummary)
    .sort((left, right) => right.playbackEventCount - left.playbackEventCount || left.id.localeCompare(right.id))
  const sortedDates = dates.sort()
  const unresolved = summaries.filter(summary => summary.titleType === 'unknown')

  return {
    totals: {
      playbackEvents: summaries.reduce((total, summary) => total + summary.playbackEventCount, 0),
      distinctNormalizedTitles: summaries.length,
      sourceEventCounts,
      knownSeries: summaries.filter(summary => summary.titleType === 'series').length,
      knownMovies: summaries.filter(summary => summary.titleType === 'movie').length,
      unresolvedTitles: unresolved.length,
      dateRange: sortedDates.length ? { earliest: sortedDates[0], latest: sortedDates[sortedDates.length - 1] } : null
    },
    summaries,
    mostViewed: summaries.slice(0, 10),
    multiSourceTitles: summaries.filter(summary => summary.sourceIds.length > 1),
    unresolvedReferences: unresolved
  }
}
