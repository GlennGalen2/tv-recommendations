import { deriveViewingAnalysis } from './viewingAnalysis.js'

const DATABASE_NAME = 'tv-recommendations-private'
const DATABASE_VERSION = 2
const RECORD_SCHEMA_VERSION = 1
export const PRIVATE_BACKUP_FORMAT = 'tv-recommendations-private-backup'
export const PRIVATE_BACKUP_FORMAT_VERSION = 2

export const PRIVATE_STORES = Object.freeze({
  metadata: 'metadata',
  titles: 'titles',
  viewers: 'viewers',
  sources: 'sources',
  importBatches: 'importBatches',
  historyEvents: 'historyEvents',
  reactions: 'reactions',
  preferenceEvidence: 'preferenceEvidence',
  recommendations: 'recommendations',
  identityResolutions: 'identityResolutions'
})

const RECORD_STORES = new Set([
  PRIVATE_STORES.titles,
  PRIVATE_STORES.viewers,
  PRIVATE_STORES.sources,
  PRIVATE_STORES.importBatches,
  PRIVATE_STORES.historyEvents,
  PRIVATE_STORES.reactions,
  PRIVATE_STORES.preferenceEvidence,
  PRIVATE_STORES.recommendations,
  PRIVATE_STORES.identityResolutions
])

const BACKUP_STORES = Object.freeze(Object.values(PRIVATE_STORES))
const PRIVATE_STORE_NAMES = new Set(BACKUP_STORES)

const IMMUTABLE_STORES = new Set([
  PRIVATE_STORES.historyEvents,
  PRIVATE_STORES.reactions,
  PRIVATE_STORES.identityResolutions
])

const REACTION_VALUES = new Set([
  'loved',
  'liked',
  'okay',
  'disliked',
  'abandoned',
  'unknown'
])

let databasePromise

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionAsPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}

function requireIndexedDb() {
  if (!isPrivateStoreSupported()) {
    throw new Error('IndexedDB is unavailable in this browser context.')
  }
}

function requireStoreName(storeName) {
  if (!PRIVATE_STORE_NAMES.has(storeName)) {
    throw new Error(`Unknown private record store: ${storeName}`)
  }
}

function requireRecord(record, storeName) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError(`${storeName} records must be objects.`)
  }

  if (typeof record.id !== 'string' || !record.id.trim()) {
    throw new TypeError(`${storeName} records require a non-empty stable id.`)
  }

  if (record.schemaVersion !== RECORD_SCHEMA_VERSION) {
    throw new TypeError(
      `${storeName} records require schemaVersion ${RECORD_SCHEMA_VERSION}.`
    )
  }
}

function requireReaction(record) {
  if (!REACTION_VALUES.has(record.reaction)) {
    throw new TypeError('Reaction records require a supported explicit reaction.')
  }

  if (typeof record.viewerId !== 'string' || typeof record.titleId !== 'string') {
    throw new TypeError('Reaction records require viewerId and titleId.')
  }
}

function rejectRawImportPayload(record) {
  const prohibitedFields = [
    'rawData',
    'rawExport',
    'rawPayload',
    'fileContents'
  ]

  for (const field of prohibitedFields) {
    if (field in record) {
      throw new TypeError(
        `Import batches retain provenance only; ${field} must not be stored.`
      )
    }
  }
}

function createStore(database, upgradeTransaction, name, options, indexes = []) {
  const store = database.objectStoreNames.contains(name)
    ? upgradeTransaction.objectStore(name)
    : database.createObjectStore(name, options)

  for (const index of indexes) {
    if (!store.indexNames.contains(index.name)) {
      store.createIndex(index.name, index.keyPath, index.options)
    }
  }
}

function createObjectStores(database, upgradeTransaction) {
  createStore(database, upgradeTransaction, PRIVATE_STORES.metadata, { keyPath: 'key' })
  createStore(database, upgradeTransaction, PRIVATE_STORES.titles, { keyPath: 'id' }, [
    { name: 'by-type', keyPath: 'type' }
  ])
  createStore(database, upgradeTransaction, PRIVATE_STORES.viewers, { keyPath: 'id' }, [
    { name: 'by-active', keyPath: 'active' }
  ])
  createStore(database, upgradeTransaction, PRIVATE_STORES.sources, { keyPath: 'id' }, [
    { name: 'by-kind', keyPath: 'kind' }
  ])
  createStore(database, upgradeTransaction, PRIVATE_STORES.importBatches, { keyPath: 'id' }, [
    { name: 'by-source', keyPath: 'sourceId' },
    { name: 'by-imported-at', keyPath: 'importedAt' }
  ])
  createStore(database, upgradeTransaction, PRIVATE_STORES.historyEvents, { keyPath: 'id' }, [
    { name: 'by-viewer', keyPath: 'viewerIds', options: { multiEntry: true } },
    { name: 'by-title', keyPath: 'titleId' },
    { name: 'by-occurred-at', keyPath: 'occurredAt' },
    { name: 'by-source', keyPath: 'provenance.sourceId' }
  ])
  createStore(database, upgradeTransaction, PRIVATE_STORES.reactions, { keyPath: 'id' }, [
    { name: 'by-viewer', keyPath: 'viewerId' },
    { name: 'by-title', keyPath: 'titleId' },
    { name: 'by-viewer-title', keyPath: ['viewerId', 'titleId'] },
    { name: 'by-recorded-at', keyPath: 'recordedAt' }
  ])
  createStore(database, upgradeTransaction, PRIVATE_STORES.preferenceEvidence, { keyPath: 'id' }, [
    { name: 'by-viewer', keyPath: 'viewerId' },
    { name: 'by-generated-at', keyPath: 'derivation.generatedAt' }
  ])
  createStore(database, upgradeTransaction, PRIVATE_STORES.recommendations, { keyPath: 'id' }, [
    { name: 'by-title', keyPath: 'titleId' },
    { name: 'by-target', keyPath: 'target.id' },
    { name: 'by-generated-at', keyPath: 'generatedAt' }
  ])
  createStore(database, upgradeTransaction, PRIVATE_STORES.identityResolutions, { keyPath: 'id' }, [
    { name: 'by-source-title', keyPath: 'sourceTitleId' },
    { name: 'by-status', keyPath: 'status' },
    { name: 'by-recorded-at', keyPath: 'recordedAt' }
  ])
}

export function isPrivateStoreSupported() {
  return typeof indexedDB !== 'undefined'
}

export function openPrivateStore() {
  requireIndexedDb()

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

      request.onupgradeneeded = () => {
        createObjectStores(request.result, request.transaction)
      }
      request.onsuccess = () => {
        const database = request.result

        database.onversionchange = () => {
          database.close()
          databasePromise = undefined
        }

        resolve(database)
      }
      request.onerror = () => {
        databasePromise = undefined
        reject(request.error)
      }
      request.onblocked = () => {
        reject(new Error('Close other app tabs before upgrading private data.'))
      }
    })
  }

  return databasePromise
}

export async function initializePrivateStore() {
  const database = await openPrivateStore()
  const transaction = database.transaction(PRIVATE_STORES.metadata, 'readwrite')
  const metadata = transaction.objectStore(PRIVATE_STORES.metadata)
  const currentVersion = await requestAsPromise(
    metadata.get('recordSchemaVersion')
  )

  if (!currentVersion) {
    metadata.add({
      key: 'recordSchemaVersion',
      value: RECORD_SCHEMA_VERSION,
      initializedAt: new Date().toISOString()
    })
  }

  await transactionAsPromise(transaction)

  return {
    databaseName: DATABASE_NAME,
    databaseVersion: DATABASE_VERSION,
    recordSchemaVersion: RECORD_SCHEMA_VERSION
  }
}

export async function createPrivateRecord(storeName, record) {
  requireStoreName(storeName)
  requireRecord(record, storeName)

  if (storeName === PRIVATE_STORES.reactions) {
    requireReaction(record)
  }

  if (storeName === PRIVATE_STORES.importBatches) {
    rejectRawImportPayload(record)
  }

  const database = await openPrivateStore()
  const transaction = database.transaction(storeName, 'readwrite')
  transaction.objectStore(storeName).add(record)
  await transactionAsPromise(transaction)

  return record.id
}

export async function readPrivateRecord(storeName, id) {
  requireStoreName(storeName)
  const database = await openPrivateStore()
  const transaction = database.transaction(storeName, 'readonly')
  const record = await requestAsPromise(transaction.objectStore(storeName).get(id))
  await transactionAsPromise(transaction)
  return record ?? null
}

export async function listPrivateRecords(storeName, options = {}) {
  requireStoreName(storeName)
  const database = await openPrivateStore()
  const transaction = database.transaction(storeName, 'readonly')
  const store = transaction.objectStore(storeName)
  const source = options.indexName ? store.index(options.indexName) : store
  const records = await requestAsPromise(source.getAll(options.query))
  await transactionAsPromise(transaction)
  return records
}

export async function getPrivateViewingAnalysis() {
  const [events, titles, sources, resolutions] = await Promise.all([
    listPrivateRecords(PRIVATE_STORES.historyEvents),
    listPrivateRecords(PRIVATE_STORES.titles),
    listPrivateRecords(PRIVATE_STORES.sources),
    listPrivateRecords(PRIVATE_STORES.identityResolutions)
  ])

  return deriveViewingAnalysis({ events, titles, sources, resolutions })
}

const IDENTITY_RESOLUTION_STATUSES = new Set([
  'unresolved',
  'candidate-match',
  'confidently-resolved',
  'manually-confirmed',
  'manually-rejected'
])

function requireIdentityResolution(record) {
  if (typeof record.sourceTitleId !== 'string' || !record.sourceTitleId.trim()) {
    throw new TypeError('Identity resolutions require a sourceTitleId.')
  }
  if (!IDENTITY_RESOLUTION_STATUSES.has(record.status)) {
    throw new TypeError('Identity resolutions require a supported status.')
  }
  if (!Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) {
    throw new TypeError('Identity resolutions require confidence from 0 through 1.')
  }
  if (typeof record.resolutionMethod !== 'string' || !record.resolutionMethod.trim()) {
    throw new TypeError('Identity resolutions require a resolutionMethod.')
  }
  if (typeof record.recordedAt !== 'string' || Number.isNaN(Date.parse(record.recordedAt))) {
    throw new TypeError('Identity resolutions require a recordedAt timestamp.')
  }
  if (record.status !== 'unresolved') {
    const candidate = record.candidate
    if (!candidate || typeof candidate.provider !== 'string' || typeof candidate.externalId !== 'string'
      || typeof candidate.mediaType !== 'string' || typeof candidate.canonicalTitle !== 'string') {
      throw new TypeError('Resolved identity records require a provider candidate with stable identity.')
    }
  }
}

export async function createIdentityResolution(record, { database: providedDatabase } = {}) {
  requireRecord(record, PRIVATE_STORES.identityResolutions)
  requireIdentityResolution(record)
  const database = providedDatabase || await openPrivateStore()
  if (record.supersedesResolutionId) {
    const transaction = database.transaction(PRIVATE_STORES.identityResolutions, 'readonly')
    const previous = await requestAsPromise(
      transaction.objectStore(PRIVATE_STORES.identityResolutions).get(record.supersedesResolutionId)
    )
    await transactionAsPromise(transaction)
    if (!previous || previous.sourceTitleId !== record.sourceTitleId) {
      throw new Error('An identity resolution can only supersede the same source title.')
    }
  }
  const transaction = database.transaction(PRIVATE_STORES.identityResolutions, 'readwrite')
  transaction.objectStore(PRIVATE_STORES.identityResolutions).add(record)
  await transactionAsPromise(transaction)
  return record.id
}

function latestResolutionsByTitle(records) {
  const superseded = new Set(records.map(record => record.supersedesResolutionId).filter(Boolean))
  const latest = records.filter(record => !superseded.has(record.id))
  return new Map(latest.map(record => [record.sourceTitleId, record]))
}

export async function getPrivateIdentityResolutionReview() {
  const [titles, resolutions] = await Promise.all([
    listPrivateRecords(PRIVATE_STORES.titles),
    listPrivateRecords(PRIVATE_STORES.identityResolutions)
  ])
  const latest = latestResolutionsByTitle(resolutions)
  const counts = {
    unresolved: 0,
    candidateMatch: 0,
    confidentlyResolved: 0,
    manuallyConfirmed: 0,
    manuallyRejected: 0
  }

  for (const title of titles) {
    const status = latest.get(title.id)?.status || (title.type === 'unknown' ? 'unresolved' : null)
    if (!status) continue
    const countKey = {
      unresolved: 'unresolved',
      'candidate-match': 'candidateMatch',
      'confidently-resolved': 'confidentlyResolved',
      'manually-confirmed': 'manuallyConfirmed',
      'manually-rejected': 'manuallyRejected'
    }[status]
    counts[countKey] += 1
  }

  return {
    counts,
    resolutions: [...latest.values()].sort((left, right) => right.recordedAt.localeCompare(left.recordedAt)),
    syntheticDemo: latest.get('synthetic:identity-resolution-demo') || null
  }
}

export async function undoIdentityResolution(resolutionId, { database: providedDatabase } = {}) {
  const database = providedDatabase || await openPrivateStore()
  const transaction = database.transaction(PRIVATE_STORES.identityResolutions, 'readonly')
  const previous = await requestAsPromise(
    transaction.objectStore(PRIVATE_STORES.identityResolutions).get(resolutionId)
  )
  await transactionAsPromise(transaction)
  if (!previous) throw new Error('The identity resolution no longer exists.')
  return createIdentityResolution({
    id: `resolution_undo_${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`,
    schemaVersion: RECORD_SCHEMA_VERSION,
    sourceTitleId: previous.sourceTitleId,
    status: 'unresolved',
    candidate: null,
    confidence: 0,
    resolutionMethod: 'manual-undo',
    rationale: ['Prior resolution explicitly undone.'],
    recordedAt: new Date().toISOString(),
    supersedesResolutionId: previous.id
  }, { database })
}

function recordReferencesTitle(record, titleId, seen = new Set()) {
  if (record === titleId) return true
  if (!record || typeof record !== 'object') return false
  if (seen.has(record)) return false
  seen.add(record)
  return Object.values(record).some(value => recordReferencesTitle(value, titleId, seen))
}

export async function getPrivateImportBatches() {
  const [batches, events, sources] = await Promise.all([
    listPrivateRecords(PRIVATE_STORES.importBatches),
    listPrivateRecords(PRIVATE_STORES.historyEvents),
    listPrivateRecords(PRIVATE_STORES.sources)
  ])
  const sourcesById = new Map(sources.map(source => [source.id, source]))

  return batches.map(batch => ({
    ...batch,
    sourceName: sourcesById.get(batch.sourceId)?.name || batch.sourceId,
    historyEventCount: events.filter(event => event.provenance?.importBatchId === batch.id).length
  })).sort((left, right) => (right.importedAt || '').localeCompare(left.importedAt || ''))
}

export async function removePrivateImportBatch(batchId, { database: providedDatabase } = {}) {
  if (typeof batchId !== 'string' || !batchId.trim()) {
    throw new TypeError('An import batch id is required for removal.')
  }

  const database = providedDatabase || await openPrivateStore()
  const transaction = database.transaction([
    PRIVATE_STORES.importBatches,
    PRIVATE_STORES.historyEvents,
    PRIVATE_STORES.titles,
    PRIVATE_STORES.reactions,
    PRIVATE_STORES.preferenceEvidence,
    PRIVATE_STORES.recommendations,
    PRIVATE_STORES.identityResolutions,
    PRIVATE_STORES.metadata,
    PRIVATE_STORES.viewers,
    PRIVATE_STORES.sources
  ], 'readwrite')
  const completion = transactionAsPromise(transaction)
  const batches = transaction.objectStore(PRIVATE_STORES.importBatches)
  const historyEvents = transaction.objectStore(PRIVATE_STORES.historyEvents)
  const titles = transaction.objectStore(PRIVATE_STORES.titles)
  const batch = await requestAsPromise(batches.get(batchId))

  if (!batch) {
    await completion
    throw new Error('The selected import batch no longer exists.')
  }

  const [allBatches, allEvents, allReactions, allEvidence, allRecommendations, allIdentityResolutions, allMetadata, allViewers, allSources] = await Promise.all([
    requestAsPromise(batches.getAll()),
    requestAsPromise(historyEvents.getAll()),
    requestAsPromise(transaction.objectStore(PRIVATE_STORES.reactions).getAll()),
    requestAsPromise(transaction.objectStore(PRIVATE_STORES.preferenceEvidence).getAll()),
    requestAsPromise(transaction.objectStore(PRIVATE_STORES.recommendations).getAll()),
    requestAsPromise(transaction.objectStore(PRIVATE_STORES.identityResolutions).getAll()),
    requestAsPromise(transaction.objectStore(PRIVATE_STORES.metadata).getAll()),
    requestAsPromise(transaction.objectStore(PRIVATE_STORES.viewers).getAll()),
    requestAsPromise(transaction.objectStore(PRIVATE_STORES.sources).getAll())
  ])
  const affectedEvents = allEvents.filter(event => event.provenance?.importBatchId === batchId)
  const affectedTitleIds = new Set(affectedEvents.map(event => event.titleId))
  const remainingEvents = allEvents.filter(event => event.provenance?.importBatchId !== batchId)
  const otherRecords = [
    ...allBatches.filter(candidate => candidate.id !== batchId),
    ...remainingEvents,
    ...allReactions,
    ...allEvidence,
    ...allRecommendations,
    ...allIdentityResolutions,
    ...allMetadata,
    ...allViewers,
    ...allSources
  ]
  const orphanedTitleIds = [...affectedTitleIds].filter(titleId =>
    !otherRecords.some(record => recordReferencesTitle(record, titleId))
  )

  for (const event of affectedEvents) historyEvents.delete(event.id)
  batches.delete(batchId)
  for (const titleId of orphanedTitleIds) titles.delete(titleId)
  await completion

  return {
    removedBatchId: batchId,
    removedHistoryEvents: affectedEvents.length,
    removedTitles: orphanedTitleIds.length
  }
}

export async function updatePrivateRecord(storeName, id, changes) {
  requireStoreName(storeName)

  if (IMMUTABLE_STORES.has(storeName)) {
    throw new Error(
      `${storeName} is append-only. Create a new record instead of updating it.`
    )
  }

  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new TypeError('Record changes must be an object.')
  }

  const existing = await readPrivateRecord(storeName, id)

  if (!existing) {
    throw new Error(`Cannot update missing ${storeName} record: ${id}`)
  }

  const updated = {
    ...existing,
    ...changes,
    id: existing.id,
    schemaVersion: existing.schemaVersion,
    updatedAt: new Date().toISOString()
  }

  requireRecord(updated, storeName)

  if (storeName === PRIVATE_STORES.importBatches) {
    rejectRawImportPayload(updated)
  }

  const database = await openPrivateStore()
  const transaction = database.transaction(storeName, 'readwrite')
  transaction.objectStore(storeName).put(updated)
  await transactionAsPromise(transaction)

  return updated
}

export async function createHistoryEvent(event) {
  return createPrivateRecord(PRIVATE_STORES.historyEvents, event)
}

export async function commitPrivateImport({ source, batch, titles = [], events = [] }) {
  requireRecord(source, PRIVATE_STORES.sources)
  requireRecord(batch, PRIVATE_STORES.importBatches)
  rejectRawImportPayload(batch)

  for (const title of titles) {
    requireRecord(title, PRIVATE_STORES.titles)
  }

  for (const event of events) {
    requireRecord(event, PRIVATE_STORES.historyEvents)
  }

  const database = await openPrivateStore()
  const transaction = database.transaction([
    PRIVATE_STORES.sources,
    PRIVATE_STORES.importBatches,
    PRIVATE_STORES.titles,
    PRIVATE_STORES.historyEvents
  ], 'readwrite')
  const sources = transaction.objectStore(PRIVATE_STORES.sources)
  const batches = transaction.objectStore(PRIVATE_STORES.importBatches)
  const titleStore = transaction.objectStore(PRIVATE_STORES.titles)
  const historyEvents = transaction.objectStore(PRIVATE_STORES.historyEvents)
  const existingBatch = await requestAsPromise(batches.get(batch.id))

  if (existingBatch) {
    await transactionAsPromise(transaction)
    return {
      batchAlreadyImported: true,
      importedTitles: 0,
      importedEvents: 0,
      skippedEvents: events.length
    }
  }

  if (!await requestAsPromise(sources.get(source.id))) {
    sources.add(source)
  }

  let importedTitles = 0
  let importedEvents = 0
  let skippedEvents = 0

  for (const title of titles) {
    if (!await requestAsPromise(titleStore.get(title.id))) {
      titleStore.add(title)
      importedTitles += 1
    }
  }

  for (const event of events) {
    if (await requestAsPromise(historyEvents.get(event.id))) {
      skippedEvents += 1
      continue
    }

    historyEvents.add({
      ...event,
      provenance: {
        ...event.provenance,
        importBatchId: batch.id
      }
    })
    importedEvents += 1
  }

  batches.add({
    ...batch,
    recordCount: importedEvents,
    recognizedRowCount: events.length,
    skippedDuplicateCount: skippedEvents
  })
  await transactionAsPromise(transaction)

  return {
    batchAlreadyImported: false,
    importedTitles,
    importedEvents,
    skippedEvents
  }
}

export async function createReaction(reaction) {
  return createPrivateRecord(PRIVATE_STORES.reactions, reaction)
}

export async function supersedeReaction(reaction) {
  requireReaction(reaction)

  if (typeof reaction.supersedesReactionId !== 'string') {
    throw new TypeError('A superseding reaction requires supersedesReactionId.')
  }

  const previous = await readPrivateRecord(
    PRIVATE_STORES.reactions,
    reaction.supersedesReactionId
  )

  if (!previous) {
    throw new Error('Cannot supersede a reaction that does not exist.')
  }

  if (previous.viewerId !== reaction.viewerId || previous.titleId !== reaction.titleId) {
    throw new Error('A reaction can only supersede the same viewer and title.')
  }

  return createReaction(reaction)
}

export async function exportPrivateBackup() {
  const records = {}

  for (const storeName of BACKUP_STORES) {
    records[storeName] = await listPrivateRecords(storeName)
  }

  return createPrivateBackup(records)
}

function validateMetadataRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('metadata records must be objects.')
  }

  if (typeof record.key !== 'string' || !record.key.trim()) {
    throw new TypeError('metadata records require a non-empty key.')
  }
}

function validateBackupRecords(records) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) {
    throw new TypeError('Backup records must be an object.')
  }

  for (const storeName of BACKUP_STORES) {
    if (!Array.isArray(records[storeName])) {
      throw new TypeError(`Backup ${storeName} records must be an array.`)
    }

    const identities = new Set()
    for (const record of records[storeName]) {
      if (storeName === PRIVATE_STORES.metadata) {
        validateMetadataRecord(record)
      } else {
        requireRecord(record, storeName)
      }

      if (storeName === PRIVATE_STORES.reactions) {
        requireReaction(record)
      }

      if (storeName === PRIVATE_STORES.importBatches) {
        rejectRawImportPayload(record)
      }

      const identity = storeName === PRIVATE_STORES.metadata ? record.key : record.id
      if (identities.has(identity)) {
        throw new TypeError(`Backup ${storeName} contains duplicate records.`)
      }
      identities.add(identity)
    }
  }
}

function normalizedBackupRecords(backup) {
  const records = structuredClone(backup.records)
  if (backup.formatVersion === 1 && !Array.isArray(records[PRIVATE_STORES.identityResolutions])) {
    records[PRIVATE_STORES.identityResolutions] = []
  }
  return records
}

function backupCounts(records) {
  return Object.fromEntries(
    BACKUP_STORES.map(storeName => [storeName, records[storeName].length])
  )
}

export function createPrivateBackup(records, exportedAt = new Date().toISOString()) {
  validateBackupRecords(records)

  return {
    format: PRIVATE_BACKUP_FORMAT,
    formatVersion: PRIVATE_BACKUP_FORMAT_VERSION,
    exportedAt,
    databaseVersion: DATABASE_VERSION,
    recordSchemaVersion: RECORD_SCHEMA_VERSION,
    recordCounts: backupCounts(records),
    records
  }
}

export function validatePrivateBackup(backup) {
  const problems = []

  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    problems.push('Backup must be a JSON object.')
  } else {
    if (backup.format !== PRIVATE_BACKUP_FORMAT) {
      problems.push('Backup format marker is not recognized.')
    }
    if (![1, PRIVATE_BACKUP_FORMAT_VERSION].includes(backup.formatVersion)) {
      problems.push('Backup format version is incompatible.')
    }
    if (![1, DATABASE_VERSION].includes(backup.databaseVersion)) {
      problems.push('Backup database schema version is incompatible.')
    }
    if (backup.recordSchemaVersion !== RECORD_SCHEMA_VERSION) {
      problems.push('Backup record schema version is incompatible.')
    }
    if (typeof backup.exportedAt !== 'string' || Number.isNaN(Date.parse(backup.exportedAt))) {
      problems.push('Backup export timestamp is invalid.')
    }

    try {
      const records = normalizedBackupRecords(backup)
      validateBackupRecords(records)
      const expectedCounts = backupCounts(records)
      if (!backup.recordCounts || typeof backup.recordCounts !== 'object') {
        problems.push('Backup record counts are missing.')
      } else if (Object.entries(backup.recordCounts).some(([storeName, count]) => expectedCounts[storeName] !== count)
        || (backup.formatVersion !== 1 && BACKUP_STORES.some(storeName => backup.recordCounts[storeName] !== expectedCounts[storeName]))) {
        problems.push('Backup record counts do not match its records.')
      }
    } catch {
      problems.push('Backup records do not meet the private data contract.')
    }
  }

  return {
    valid: problems.length === 0,
    problems,
    preview: backup && typeof backup === 'object' && !Array.isArray(backup)
      ? {
          exportedAt: backup.exportedAt || null,
          databaseVersion: backup.databaseVersion ?? null,
          recordSchemaVersion: backup.recordSchemaVersion ?? null,
          recordCounts: backup.recordCounts || null
        }
      : null
  }
}

export function inspectPrivateBackupJson(jsonText) {
  let backup
  try {
    backup = JSON.parse(jsonText)
  } catch {
    throw new Error('The selected file is not valid JSON.')
  }

  return { backup, validation: validatePrivateBackup(backup) }
}

export function parsePrivateBackupJson(jsonText) {
  const { backup, validation } = inspectPrivateBackupJson(jsonText)
  if (!validation.valid) {
    throw new Error('The selected file is not a compatible private-data backup.')
  }

  return { backup, validation }
}

export async function restorePrivateBackup(backup, { database: providedDatabase } = {}) {
  const validation = validatePrivateBackup(backup)
  if (!validation.valid) {
    throw new Error('Private backup validation failed; current data was not changed.')
  }

  const records = normalizedBackupRecords(backup)
  const database = providedDatabase || await openPrivateStore()
  const transaction = database.transaction(BACKUP_STORES, 'readwrite')
  const completion = transactionAsPromise(transaction)

  for (const storeName of BACKUP_STORES) {
    transaction.objectStore(storeName).clear()
  }

  for (const storeName of BACKUP_STORES) {
    const store = transaction.objectStore(storeName)
    for (const record of records[storeName]) {
      store.add(record)
    }
  }

  await completion

  return {
    restoredAt: new Date().toISOString(),
    recordCounts: backupCounts(records)
  }
}
