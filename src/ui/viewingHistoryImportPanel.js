import {
  PRIVATE_STORES,
  commitPrivateImport,
  listPrivateRecords
} from '../data/privateStore.js'

const VIEWERS = [
  { id: 'viewer-1', label: 'Viewer 1' },
  { id: 'viewer-2', label: 'Viewer 2' }
]

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count || 0} ${(count || 0) === 1 ? singular : plural}`
}

function formatDateRange(range) {
  return range ? `${range.earliest} to ${range.latest}` : 'No valid dates found'
}

export function createViewingHistoryImportPanel({
  serviceId,
  serviceName,
  fileLabel,
  parseCsv,
  buildPreview,
  requestRender,
  onImportComplete
}) {
  let state = {
    status: 'idle',
    viewerId: 'viewer-1',
    preview: null,
    error: null,
    success: null
  }

  function setState(next) {
    state = { ...state, ...next }
    requestRender()
  }

  async function previewFile(file) {
    if (!file) return
    setState({ status: 'previewing', preview: null, error: null, success: null })

    try {
      const csvText = await file.text()
      const [events, batches] = await Promise.all([
        listPrivateRecords(PRIVATE_STORES.historyEvents),
        listPrivateRecords(PRIVATE_STORES.importBatches)
      ])
      const parsed = await parseCsv(csvText, { viewerId: state.viewerId, fileName: file.name })
      const preview = buildPreview(parsed, {
        eventIds: new Set(events.map(event => event.id)),
        batchIds: new Set(batches.map(batch => batch.id))
      })
      setState({ status: 'preview', preview, error: null })
    } catch (error) {
      setState({ status: 'error', preview: null, error, success: null })
    }
  }

  async function commitPreview() {
    const preview = state.preview
    if (!preview || !preview.newEvents.length || preview.preview.batchAlreadyImported) return

    setState({ status: 'importing', error: null, success: null })
    try {
      const result = await commitPrivateImport({
        source: preview.source,
        batch: preview.batch,
        titles: preview.newTitles,
        events: preview.newEvents
      })
      await onImportComplete()
      setState({ status: 'success', preview: null, success: result, error: null })
    } catch (error) {
      setState({ status: 'error', error, success: null })
    }
  }

  function render(storeReady) {
    const preview = state.preview
    const summary = preview?.preview
    const importDisabled = !preview || !preview.newEvents.length
      || summary.batchAlreadyImported || state.status === 'importing'
    const problemSummary = summary?.problems.length
      ? `${pluralize(summary.problems.length, 'row')} need review: ${Object.entries(summary.problemCounts).map(([code, count]) => `${count} ${code}`).join(', ')}.`
      : 'No parsing problems found.'

    return `
      <section class="import-section" aria-labelledby="${serviceId}-import-heading">
        <div class="section-heading">
          <h2 id="${serviceId}-import-heading">Import ${serviceName} viewing history</h2>
          <p>CSV files are parsed locally. Nothing is saved until you confirm the preview.</p>
        </div>
        <div class="import-panel">
          <label>Viewer
            <select id="${serviceId}-import-viewer" ${storeReady ? '' : 'disabled'}>
              ${VIEWERS.map(viewer => `<option value="${viewer.id}" ${viewer.id === state.viewerId ? 'selected' : ''}>${viewer.label}</option>`).join('')}
            </select>
          </label>
          <label>${fileLabel}
            <input id="${serviceId}-import-file" type="file" accept=".csv,text/csv" ${storeReady || state.status === 'previewing' ? '' : 'disabled'} />
          </label>
          ${state.status === 'previewing' ? '<p>Parsing local CSV for preview…</p>' : ''}
          ${state.status === 'error' ? `<p class="import-error">${state.error?.message || 'Unable to prepare the import.'}</p>` : ''}
          ${preview ? `
            <div class="import-preview">
              <strong>Preview only</strong>
              <p>${pluralize(summary.totalRows, 'source row')}; ${pluralize(summary.recognizedRows, 'recognized importable row')}.</p>
              <p>${pluralize(summary.episodes, 'episode')}, ${pluralize(summary.seasons, 'season')}, ${pluralize(summary.series, 'series record')}, ${pluralize(summary.specials, 'special')}, ${pluralize(summary.unresolvedTv, 'unresolved TV record')}, ${pluralize(summary.likelyMovies, 'likely movie')}, and ${pluralize(summary.ambiguous, 'ambiguous record')}.</p>
              <p>${pluralize(summary.rejectedRows, 'row')} rejected; ${pluralize(summary.blankRowsExcluded, 'blank row')} excluded. Date range: ${formatDateRange(summary.dateRange)}${summary.assumedLocalTime ? ' (timestamps treated as local browser time)' : ''}.</p>
              ${summary.recognizedFields?.length ? `<p>Recognized fields: ${summary.recognizedFields.join(', ')}.</p>` : ''}
              ${summary.unrecognizedHeaderCount ? `<p>${pluralize(summary.unrecognizedHeaderCount, 'unrecognized header')} ignored.</p>` : ''}
              <p>${summary.batchAlreadyImported ? 'This exact file was already imported for this viewer; no records will be added.' : `${pluralize(summary.duplicateEvents, 'duplicate event')} will be skipped; ${pluralize(summary.newEvents, 'new playback event')} can be imported.`}</p>
              <p>${problemSummary}</p>
              <button class="action-button" id="${serviceId}-import-confirm" ${importDisabled ? 'disabled' : ''}>
                ${state.status === 'importing' ? 'Importing…' : `Import ${pluralize(summary.newEvents, 'event')} to private storage`}
              </button>
            </div>
          ` : ''}
          ${state.status === 'success' ? `<p class="import-success">Imported ${pluralize(state.success.importedEvents, 'playback event')} and ${pluralize(state.success.importedTitles, 'title')}. ${pluralize(state.success.skippedEvents, 'duplicate event')} skipped.</p>` : ''}
        </div>
      </section>
    `
  }

  function bind(storeReady) {
    document.querySelector(`#${serviceId}-import-viewer`)?.addEventListener('change', event => {
      state = { status: 'idle', viewerId: event.target.value, preview: null, error: null, success: null }
      requestRender()
    })
    if (storeReady) {
      document.querySelector(`#${serviceId}-import-file`)?.addEventListener('change', async event => {
        await previewFile(event.target.files?.[0])
      })
    }
    document.querySelector(`#${serviceId}-import-confirm`)?.addEventListener('click', commitPreview)
  }

  return { bind, render }
}
