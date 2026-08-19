export function buildViewingHistoryImportPreview(parsedImport, existing) {
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
