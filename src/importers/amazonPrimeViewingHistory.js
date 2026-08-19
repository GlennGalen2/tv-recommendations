import { normalizeText, parseCsvRows } from './csv.js'
import { buildViewingHistoryImportPreview } from './importPreview.js'

const SOURCE_ID = 'source:amazon-prime-video'
const IMPORTER_VERSION = 'amazon-prime-viewing-history:v1'
const HEADER_ALIASES = {
  title: ['title', 'video title', 'name'],
  date: ['date', 'watch date', 'date watched', 'watched at', 'viewing date', 'event date'],
  series: ['series', 'show', 'series title', 'show title'],
  season: ['season', 'season number'],
  episode: ['episode', 'episode title', 'episode name'],
  episodeNumber: ['episode number', 'episode #', 'episode no'],
  contentType: ['content type', 'type', 'video type', 'title type'],
  contentId: ['asin', 'content id', 'asset id', 'video id']
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled'
}

function headerKey(value) {
  return normalizeText(value.replace(/^\uFEFF/, '')).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function calendarDate(year, month, day) {
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return date.getFullYear() === Number(year)
    && date.getMonth() === Number(month) - 1
    && date.getDate() === Number(day)
    ? `${year}-${month}-${day}`
    : null
}

function parseAmazonDate(value) {
  const text = normalizeText(value)
  const match = text.match(
    /^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  )

  if (match) {
    const [, isoYear, isoMonth, isoDay, usMonth, usDay, usYear, givenHour, minute = '00', second = '00', meridiem] = match
    const year = isoYear || usYear
    const month = isoMonth || usMonth
    const day = isoDay || usDay
    const occurredOn = calendarDate(year, month.padStart(2, '0'), day.padStart(2, '0'))
    if (!occurredOn) return null

    if (givenHour === undefined) {
      return { occurredAt: null, occurredOn, displayDate: occurredOn, identityDate: occurredOn, datePrecision: 'date', assumedLocalTime: false }
    }

    let hour = Number(givenHour)
    const minuteValue = Number(minute)
    const secondValue = Number(second)
    if (meridiem) {
      if (hour < 1 || hour > 12) return null
      hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0)
    } else if (hour > 23) {
      return null
    }
    if (minuteValue > 59 || secondValue > 59) return null

    const date = new Date(Number(year), Number(month) - 1, Number(day), hour, minuteValue, secondValue)
    if (Number.isNaN(date.valueOf()) || date.getFullYear() !== Number(year)
      || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null

    return {
      occurredAt: date.toISOString(), occurredOn, displayDate: occurredOn,
      identityDate: date.toISOString(), datePrecision: 'date-time', assumedLocalTime: true
    }
  }

  const date = new Date(text)
  if (Number.isNaN(date.valueOf())) return null
  const occurredOn = date.toISOString().slice(0, 10)
  return { occurredAt: date.toISOString(), occurredOn, displayDate: occurredOn, identityDate: date.toISOString(), datePrecision: 'date-time', assumedLocalTime: false }
}

function resolveColumns(headers) {
  const normalizedHeaders = headers.map(headerKey)
  const columns = {}
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = normalizedHeaders.findIndex(header => aliases.map(headerKey).includes(header))
    if (index !== -1) columns[field] = index
  }
  return columns
}

function numericPart(value) {
  const match = normalizeText(value).match(/\d+/)
  return match ? Number(match[0]) : null
}

function classifyTitle(sourceTitle, sourceSeries, sourceSeason, sourceEpisode, sourceEpisodeNumber, sourceContentType) {
  const type = normalizeText(sourceContentType).toLowerCase()
  const seasonNumber = numericPart(sourceSeason)
  const episodeNumber = numericPart(sourceEpisodeNumber)

  if (sourceSeries) {
    if (/special/.test(type) || /^specials?$/i.test(sourceSeason)) {
      return { title: sourceSeries, type: 'series', classification: 'special', mediaScope: { level: 'special', specialTitle: sourceTitle || sourceEpisode || null } }
    }
    if (sourceEpisode || episodeNumber || /episode/.test(type)) {
      return {
        title: sourceSeries,
        type: 'series',
        classification: 'episode',
        mediaScope: {
          level: 'episode',
          ...(seasonNumber ? { seasonNumber } : {}),
          ...(episodeNumber ? { episodeNumber } : {}),
          ...(sourceEpisode || sourceTitle ? { episodeTitle: sourceEpisode || sourceTitle } : {})
        }
      }
    }
    if (seasonNumber) return { title: sourceSeries, type: 'series', classification: 'season', mediaScope: { level: 'season', seasonNumber } }
    return { title: sourceSeries, type: 'series', classification: 'series', mediaScope: { level: 'title' } }
  }

  const parts = sourceTitle.split(':').map(normalizeText)
  const markerIndex = parts.findIndex(part => /^(season\s+\d+|s\d+|series\s+\d+|limited series|specials?|season 0)$/i.test(part))
  if (markerIndex > 0) {
    const marker = parts[markerIndex]
    const childParts = parts.slice(markerIndex + 1)
    const markerSeason = numericPart(marker)
    if (/^(specials?|season 0)$/i.test(marker)) return { title: parts.slice(0, markerIndex).join(': '), type: 'series', classification: 'special', mediaScope: { level: 'special', specialTitle: childParts.join(': ') || null } }
    if (childParts.length) return { title: parts.slice(0, markerIndex).join(': '), type: 'series', classification: 'episode', mediaScope: { level: 'episode', ...(markerSeason ? { seasonNumber: markerSeason } : {}), episodeTitle: childParts.join(': ') } }
    if (markerSeason) return { title: parts.slice(0, markerIndex).join(': '), type: 'series', classification: 'season', mediaScope: { level: 'season', seasonNumber: markerSeason } }
    return { title: parts.slice(0, markerIndex).join(': '), type: 'series', classification: 'series', mediaScope: { level: 'title' } }
  }

  if (/movie|film/.test(type)) return { title: sourceTitle, type: 'movie', classification: 'likely-movie', mediaScope: { level: 'title' } }
  if (/series|show|tv/.test(type)) {
    return {
      title: sourceTitle,
      type: 'unknown',
      classification: 'unresolved-tv',
      mediaScope: { level: 'title' }
    }
  }

  return parts.length === 1
    ? { title: sourceTitle, type: 'movie', classification: 'likely-movie', mediaScope: { level: 'title' } }
    : { title: sourceTitle, type: 'unknown', classification: 'ambiguous', mediaScope: { level: 'title' } }
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function addProblem(problems, row, code, message) {
  problems.push({ row, code, message })
}

export async function parseAmazonPrimeViewingHistoryCsv(csvText, options) {
  if (typeof csvText !== 'string') throw new TypeError('Amazon CSV content must be text.')
  if (!options?.viewerId) throw new TypeError('A viewerId is required for an Amazon import.')

  const parsedRows = parseCsvRows(csvText)
  const rows = parsedRows.rows
  if (!rows.length) throw new Error('The CSV is empty.')

  const headers = rows[0].map(header => normalizeText(header.replace(/^\uFEFF/, '')))
  const columns = resolveColumns(headers)
  if (columns.title === undefined || columns.date === undefined) {
    throw new Error('Amazon CSV files must contain recognizable title and watch-date columns.')
  }

  const problems = []
  const titlesById = new Map()
  const events = []
  const sourceOccurrenceCounts = new Map()
  const classificationCounts = { likelyMovies: 0, unresolvedTv: 0, series: 0, seasons: 0, episodes: 0, specials: 0, ambiguous: 0 }
  const displayDates = []
  let assumedLocalTime = false

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    const rowNumber = index + 1
    const field = name => columns[name] === undefined ? '' : normalizeText(row[columns[name]] || '')
    const sourceTitle = field('title')
    const sourceDate = field('date')
    const date = parseAmazonDate(sourceDate)
    const sourceSeries = field('series')
    const sourceSeason = field('season')
    const sourceEpisode = field('episode')
    const sourceEpisodeNumber = field('episodeNumber')
    const sourceContentType = field('contentType')
    const sourceContentId = field('contentId')

    if (!sourceTitle) {
      addProblem(problems, rowNumber, 'missing-title', 'Title is missing.')
      continue
    }
    if (!date) {
      addProblem(problems, rowNumber, 'invalid-date', 'Watch date is missing or invalid.')
      continue
    }

    const parsedTitle = classifyTitle(sourceTitle, sourceSeries, sourceSeason, sourceEpisode, sourceEpisodeNumber, sourceContentType)
    const classificationKey = { 'likely-movie': 'likelyMovies', 'unresolved-tv': 'unresolvedTv', series: 'series', season: 'seasons', episode: 'episodes', special: 'specials', ambiguous: 'ambiguous' }[parsedTitle.classification]
    classificationCounts[classificationKey] += 1
    if (parsedTitle.classification === 'ambiguous') {
      addProblem(problems, rowNumber, 'ambiguous-title', 'Title syntax does not provide enough information to distinguish a movie from series content.')
    }

    assumedLocalTime ||= date.assumedLocalTime
    displayDates.push(date.displayDate)
    const titleHash = await sha256(`${parsedTitle.type}|${parsedTitle.title.toLowerCase()}`)
    const titleId = `title:amazon:${slugify(parsedTitle.title).slice(0, 40)}:${titleHash.slice(0, 10)}`
    const sourceIdentity = sourceContentId
      ? `${sourceContentId}|${date.identityDate}`
      : [sourceSeries, sourceTitle, date.identityDate, sourceSeason, sourceEpisode, sourceEpisodeNumber, sourceContentType].join('|')
    const occurrence = sourceOccurrenceCounts.get(sourceIdentity) || 0
    sourceOccurrenceCounts.set(sourceIdentity, occurrence + 1)
    const eventHash = await sha256(`${options.viewerId}|${sourceIdentity}|${occurrence}`)

    if (!titlesById.has(titleId)) {
      titlesById.set(titleId, { id: titleId, schemaVersion: 1, type: parsedTitle.type, title: parsedTitle.title, originalTitle: sourceTitle, externalIds: {}, provenance: { sourceId: SOURCE_ID } })
    }
    events.push({
      id: `evt_amazon_${eventHash.slice(0, 24)}`,
      schemaVersion: 1,
      viewerIds: [options.viewerId],
      titleId,
      eventType: 'playback',
      mediaScope: parsedTitle.mediaScope,
      occurredAt: date.occurredAt,
      occurredOn: date.occurredOn,
      observations: {
        sourceTitle, sourceDate, datePrecision: date.datePrecision,
        ...(sourceSeries ? { sourceSeries } : {}),
        ...(sourceSeason ? { sourceSeason } : {}),
        ...(sourceEpisode ? { sourceEpisode } : {}),
        ...(sourceEpisodeNumber ? { sourceEpisodeNumber } : {}),
        ...(sourceContentType ? { sourceContentType } : {}),
        ...(sourceContentId ? { sourceContentId } : {})
      },
      provenance: { sourceId: SOURCE_ID, importBatchId: null, sourceRecordId: `amazon:${eventHash}`, sourceRowNumber: rowNumber }
    })
  }

  const contentHash = await sha256(csvText)
  const batchHash = await sha256(`${options.viewerId}|${contentHash}`)
  const problemCounts = problems.reduce((counts, problem) => {
    counts[problem.code] = (counts[problem.code] || 0) + 1
    return counts
  }, {})
  const dates = displayDates.sort()
  const recognizedColumnIndexes = new Set(Object.values(columns))

  return {
    source: { id: SOURCE_ID, schemaVersion: 1, name: 'Amazon Prime Video', kind: 'streaming-service' },
    batch: {
      id: `import:amazon-prime-video:${batchHash.slice(0, 24)}`,
      schemaVersion: 1, sourceId: SOURCE_ID, importedAt: new Date().toISOString(),
      sourceFileName: options.fileName || null, sourceHash: { algorithm: 'sha256', value: contentHash },
      importerVersion: IMPORTER_VERSION, recordCount: events.length, viewerId: options.viewerId
    },
    titles: [...titlesById.values()],
    events,
    summary: {
      totalRows: Math.max(rows.length - 1, 0),
      blankRowsExcluded: parsedRows.blankRows,
      recognizedRows: events.length,
      rejectedRows: (problemCounts['missing-title'] || 0) + (problemCounts['invalid-date'] || 0),
      ...classificationCounts,
      dateRange: dates.length ? { earliest: dates[0], latest: dates[dates.length - 1] } : null,
      assumedLocalTime,
      recognizedFields: Object.keys(columns),
      unrecognizedHeaderCount: headers.filter((_, index) => !recognizedColumnIndexes.has(index)).length,
      problems,
      problemCounts
    }
  }
}

export function buildAmazonPrimeImportPreview(parsedImport, existing) {
  return buildViewingHistoryImportPreview(parsedImport, existing)
}
