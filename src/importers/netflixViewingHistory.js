const SOURCE_ID = 'source:netflix'
const IMPORTER_VERSION = 'netflix-viewing-history:v1'

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled'
}

function csvRows(text) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(value)
      value = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1
      }

      row.push(value)
      if (row.some(cell => cell.length > 0)) {
        rows.push(row)
      }
      row = []
      value = ''
    } else {
      value += character
    }
  }

  if (quoted) {
    throw new Error('The CSV contains an unterminated quoted value.')
  }

  row.push(value)
  if (row.some(cell => cell.length > 0)) {
    rows.push(row)
  }

  return rows
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

function parseTitle(sourceTitle) {
  const parts = sourceTitle.split(':').map(normalizeText)
  const seasonIndex = parts.findIndex(part => /^(season\s+\d+|s\d+)$/i.test(part))

  if (seasonIndex > 0) {
    const seasonMatch = parts[seasonIndex].match(/(?:season\s+|s)(\d+)/i)
    const episodePart = parts.slice(seasonIndex + 1).find(part =>
      /^(episode\s+\d+|chapter\s+\d+|e\d+)$/i.test(part)
    )
    const episodeMatch = episodePart?.match(/(?:episode\s+|chapter\s+|e)(\d+)/i)

    return {
      title: parts.slice(0, seasonIndex).join(': '),
      type: 'series',
      classification: episodeMatch ? 'episode' : 'likely-series',
      mediaScope: episodeMatch
        ? {
            level: 'episode',
            seasonNumber: Number(seasonMatch[1]),
            episodeNumber: Number(episodeMatch[1])
          }
        : { level: 'title' }
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

  const rows = csvRows(csvText)

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
    likelySeries: 0,
    episodes: 0,
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
    classificationCounts[
      parsedTitle.classification === 'likely-movie'
        ? 'likelyMovies'
        : parsedTitle.classification === 'likely-series'
          ? 'likelySeries'
          : parsedTitle.classification === 'episode'
            ? 'episodes'
            : 'ambiguous'
    ] += 1

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
      recognizedRows: events.length,
      ...classificationCounts,
      dateRange: dates.length
        ? { earliest: dates[0], latest: dates[dates.length - 1] }
        : null,
      assumedLocalTime,
      problems
    }
  }
}

export function buildNetflixImportPreview(parsedImport, existing) {
  const existingEventIds = existing?.eventIds || new Set()
  const existingBatchIds = existing?.batchIds || new Set()
  const batchAlreadyImported = existingBatchIds.has(parsedImport.batch.id)
  const duplicateEvents = batchAlreadyImported
    ? parsedImport.events.length
    : parsedImport.events.filter(event => existingEventIds.has(event.id)).length
  const newEvents = batchAlreadyImported
    ? []
    : parsedImport.events.filter(event => !existingEventIds.has(event.id))
  const newTitleIds = new Set(newEvents.map(event => event.titleId))

  return {
    ...parsedImport,
    newEvents,
    newTitles: parsedImport.titles.filter(title => newTitleIds.has(title.id)),
    preview: {
      ...parsedImport.summary,
      batchAlreadyImported,
      duplicateEvents,
      newEvents: newEvents.length
    }
  }
}
