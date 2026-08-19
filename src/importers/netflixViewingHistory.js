const SOURCE_ID = 'source:netflix'
const IMPORTER_VERSION = 'netflix-viewing-history:v1'
import { normalizeText, parseCsvRows } from './csv.js'
import { buildViewingHistoryImportPreview } from './importPreview.js'

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled'
}

function headerIndex(headers, name) {
  return headers.findIndex(header => header.toLowerCase() === name)
}

function calendarDate(year, month, day) {
  const date = new Date(Number(year), Number(month) - 1, Number(day))

  return date.getFullYear() === Number(year)
    && date.getMonth() === Number(month) - 1
    && date.getDate() === Number(day)
    ? `${year}-${month}-${day}`
    : null
}

function parseNetflixDate(value) {
  const text = normalizeText(value)
  const localMatch = text.match(
    /^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  )

  if (localMatch) {
    const [, isoYear, isoMonth, isoDay, usMonth, usDay, usYear, providedHour, minute = '00', second = '00', meridiem] = localMatch
    const year = isoYear || usYear
    const month = isoMonth || usMonth
    const day = isoDay || usDay
    const occurredOn = calendarDate(year, month.padStart(2, '0'), day.padStart(2, '0'))

    if (!occurredOn) {
      return null
    }

    if (providedHour === undefined) {
      return {
        occurredAt: null,
        occurredOn,
        displayDate: occurredOn,
        identityDate: occurredOn,
        datePrecision: 'date',
        assumedLocalTime: false
      }
    }

    let hour = Number(providedHour)
    const minuteValue = Number(minute)
    const secondValue = Number(second)
    if (meridiem) {
      if (hour < 1 || hour > 12) {
        return null
      }
      hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0)
    } else if (hour > 23) {
      return null
    }

    if (minuteValue > 59 || secondValue > 59) {
      return null
    }

    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      hour,
      minuteValue,
      secondValue
    )

    return Number.isNaN(date.valueOf())
      || date.getFullYear() !== Number(year)
      || date.getMonth() !== Number(month) - 1
      || date.getDate() !== Number(day)
      ? null
      : {
          occurredAt: date.toISOString(),
          occurredOn,
          displayDate: occurredOn,
          identityDate: date.toISOString(),
          datePrecision: 'date-time',
          assumedLocalTime: true
        }
  }

  const date = new Date(text)

  return Number.isNaN(date.valueOf())
    ? null
    : {
        occurredAt: date.toISOString(),
        occurredOn: date.toISOString().slice(0, 10),
        displayDate: date.toISOString().slice(0, 10),
        identityDate: date.toISOString(),
        datePrecision: 'date-time',
        assumedLocalTime: false
      }
}

function parseRating(value) {
  const raw = normalizeText(value || '')

  if (!raw) {
    return { raw: null, value: null }
  }

  const numericValue = Number(raw)
  return Number.isFinite(numericValue)
    ? { raw, value: numericValue }
    : { raw, value: null }
}

function parseEpisodePart(parts) {
  const explicitEpisodeIndex = parts.findIndex(part => /^(episode|chapter)\s+\d+|^e\d+$/i.test(part))
  const explicitEpisode = explicitEpisodeIndex === -1 ? null : parts[explicitEpisodeIndex]
  const match = explicitEpisode?.match(/(?:episode\s+|chapter\s+|e)(\d+)/i)

  return {
    episodeNumber: match ? Number(match[1]) : null,
    episodeTitle: parts.filter((_, index) => index !== explicitEpisodeIndex).join(': ') || null
  }
}

function parseTitle(sourceTitle) {
  const parts = sourceTitle.split(':').map(normalizeText)
  const collectionIndex = parts.findIndex(part =>
    /^(season\s+\d+|s\d+|series\s+\d+|limited series|specials?|season 0)$/i.test(part)
  )

  if (collectionIndex > 0) {
    const collection = parts[collectionIndex]
    const seasonMatch = collection.match(/(?:season\s+|s)(\d+)/i)
    const seriesMatch = collection.match(/^series\s+(\d+)$/i)
    const isSpecial = /^(specials?|season 0)$/i.test(collection)
    const childParts = parts.slice(collectionIndex + 1)

    if (isSpecial) {
      return {
        title: parts.slice(0, collectionIndex).join(': '),
        type: 'series',
        classification: 'special',
        mediaScope: {
          level: 'special',
          specialTitle: childParts.join(': ') || null
        }
      }
    }

    if (childParts.length) {
      const episode = parseEpisodePart(childParts)

      return {
        title: parts.slice(0, collectionIndex).join(': '),
        type: 'series',
        classification: 'episode',
        mediaScope: {
          level: 'episode',
          ...(seasonMatch ? { seasonNumber: Number(seasonMatch[1]) } : {}),
          ...(seriesMatch ? { seriesNumber: Number(seriesMatch[1]) } : {}),
          ...(episode.episodeNumber ? { episodeNumber: episode.episodeNumber } : {}),
          ...(episode.episodeTitle ? { episodeTitle: episode.episodeTitle } : {})
        }
      }
    }

    if (seasonMatch) {
      return {
        title: parts.slice(0, collectionIndex).join(': '),
        type: 'series',
        classification: 'season',
        mediaScope: { level: 'season', seasonNumber: Number(seasonMatch[1]) }
      }
    }

    return {
      title: parts.slice(0, collectionIndex).join(': '),
      type: 'series',
      classification: 'series',
      mediaScope: {
        level: 'title',
        seriesKind: collection.toLowerCase() === 'limited series' ? 'limited-series' : 'series',
        seriesNumber: seriesMatch ? Number(seriesMatch[1]) : null
      }
    }
  }

  if (parts.length === 1) {
    return {
      title: sourceTitle,
      type: 'movie',
      classification: 'likely-movie',
      mediaScope: { level: 'title' }
    }
  }

  return {
    title: sourceTitle,
    type: 'unknown',
    classification: 'ambiguous',
    mediaScope: { level: 'title' }
  }
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function makeProblem(row, code, message) {
  return { row, code, message }
}

export async function parseNetflixViewingHistoryCsv(csvText, options) {
  if (typeof csvText !== 'string') {
    throw new TypeError('Netflix CSV content must be text.')
  }

  if (!options?.viewerId) {
    throw new TypeError('A viewerId is required for a Netflix import.')
  }

  const parsedRows = parseCsvRows(csvText)
  const rows = parsedRows.rows

  if (!rows.length) {
    throw new Error('The CSV is empty.')
  }

  const headers = rows[0].map(header => normalizeText(header.replace(/^\uFEFF/, '')))
  const titleColumn = headerIndex(headers, 'title')
  const dateColumn = headerIndex(headers, 'date')
  const ratingColumn = headerIndex(headers, 'rating')

  if (titleColumn === -1 || dateColumn === -1) {
    throw new Error('Netflix CSV files must contain Title and Date columns.')
  }

  const problems = []
  const titlesById = new Map()
  const events = []
  const sourceOccurrenceCounts = new Map()
  const classificationCounts = {
    likelyMovies: 0,
    series: 0,
    seasons: 0,
    episodes: 0,
    specials: 0,
    ambiguous: 0
  }
  const displayDates = []
  let assumedLocalTime = false

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    const rowNumber = index + 1
    const sourceTitle = normalizeText(row[titleColumn] || '')
    const date = parseNetflixDate(row[dateColumn] || '')
    const rating = parseRating(ratingColumn === -1 ? '' : row[ratingColumn])

    if (!sourceTitle) {
      problems.push(makeProblem(rowNumber, 'missing-title', 'Title is missing.'))
      continue
    }

    if (!date) {
      problems.push(makeProblem(rowNumber, 'invalid-date', 'Date is missing or invalid.'))
      continue
    }

    assumedLocalTime ||= date.assumedLocalTime
    displayDates.push(date.displayDate)
    if (rating.raw && rating.value === null) {
      problems.push(makeProblem(
        rowNumber,
        'unrecognized-rating',
        'Rating was preserved as source metadata but is not a numeric value.'
      ))
    }
    const parsedTitle = parseTitle(sourceTitle)
    const titleHash = await sha256(`${parsedTitle.type}|${parsedTitle.title.toLowerCase()}`)
    const titleId = `title:netflix:${slugify(parsedTitle.title).slice(0, 40)}:${titleHash.slice(0, 10)}`
    const sourceOccurrenceKey = `${options.viewerId}|${sourceTitle}|${date.identityDate}`
    const sourceOccurrence = sourceOccurrenceCounts.get(sourceOccurrenceKey) || 0
    sourceOccurrenceCounts.set(sourceOccurrenceKey, sourceOccurrence + 1)
    const eventHash = await sha256(`${sourceOccurrenceKey}|${sourceOccurrence}`)
    const eventId = `evt_netflix_${eventHash.slice(0, 24)}`
    const classificationKey = {
      'likely-movie': 'likelyMovies',
      series: 'series',
      season: 'seasons',
      episode: 'episodes',
      special: 'specials',
      ambiguous: 'ambiguous'
    }[parsedTitle.classification]
    classificationCounts[classificationKey] += 1

    if (parsedTitle.classification === 'ambiguous') {
      problems.push(makeProblem(
        rowNumber,
        'ambiguous-title',
        'Title contains separators but no recognizable Netflix season and episode pattern.'
      ))
    }

    if (!titlesById.has(titleId)) {
      titlesById.set(titleId, {
        id: titleId,
        schemaVersion: 1,
        type: parsedTitle.type,
        title: parsedTitle.title,
        originalTitle: sourceTitle,
        externalIds: {},
        provenance: { sourceId: SOURCE_ID }
      })
    }

    events.push({
      id: eventId,
      schemaVersion: 1,
      viewerIds: [options.viewerId],
      titleId,
      eventType: 'playback',
      mediaScope: parsedTitle.mediaScope,
      occurredAt: date.occurredAt,
      occurredOn: date.occurredOn,
      observations: {
        sourceTitle,
        sourceDate: normalizeText(row[dateColumn] || ''),
        datePrecision: date.datePrecision,
        netflixRating: rating.value,
        netflixRatingRaw: rating.raw
      },
      provenance: {
        sourceId: SOURCE_ID,
        importBatchId: null,
        sourceRecordId: `netflix:${eventHash}`,
        sourceRowNumber: rowNumber
      }
    })
  }

  const contentHash = await sha256(csvText)
  const batchHash = await sha256(`${options.viewerId}|${contentHash}`)
  const dates = displayDates.sort()
  const problemCounts = problems.reduce((counts, problem) => {
    counts[problem.code] = (counts[problem.code] || 0) + 1
    return counts
  }, {})
  const rejectedRows = (problemCounts['missing-title'] || 0)
    + (problemCounts['invalid-date'] || 0)

  return {
    source: {
      id: SOURCE_ID,
      schemaVersion: 1,
      name: 'Netflix',
      kind: 'streaming-service'
    },
    batch: {
      id: `import:netflix:${batchHash.slice(0, 24)}`,
      schemaVersion: 1,
      sourceId: SOURCE_ID,
      importedAt: new Date().toISOString(),
      sourceFileName: options.fileName || null,
      sourceHash: { algorithm: 'sha256', value: contentHash },
      importerVersion: IMPORTER_VERSION,
      recordCount: events.length,
      viewerId: options.viewerId
    },
    titles: [...titlesById.values()],
    events,
    summary: {
      totalRows: Math.max(rows.length - 1, 0),
      blankRowsExcluded: parsedRows.blankRows,
      recognizedRows: events.length,
      rejectedRows,
      ...classificationCounts,
      dateRange: dates.length
        ? { earliest: dates[0], latest: dates[dates.length - 1] }
        : null,
      assumedLocalTime,
      problems,
      problemCounts
    }
  }
}

export function buildNetflixImportPreview(parsedImport, existing) {
  return buildViewingHistoryImportPreview(parsedImport, existing)
}
