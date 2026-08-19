import {
  PRIVATE_STORES,
  commitPrivateImport,
  listPrivateRecords
} from '../data/privateStore.js'
import {
  buildNetflixImportPreview,
  parseNetflixViewingHistoryCsv
} from '../importers/netflixViewingHistory.js'

const VIEWERS = [
  { id: 'viewer-1', label: 'Viewer 1' },
  { id: 'viewer-2', label: 'Viewer 2' }
]

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function formatDateRange(range) {
  if (!range) {
    return 'No valid dates found'
  }

  return `${range.earliest.slice(0, 10)} to ${range.latest.slice(0, 10)}`
}

export function createNetflixImportPanel({ requestRender, onImportComplete }) {
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
    if (!file) {
      return
    }

    setState({ status: 'previewing', preview: null, error: null, success: null })

    try {
      const csvText = await file.text()
      const [events, batches] = await Promise.all([
        listPrivateRecords(PRIVATE_STORES.historyEvents),
        listPrivateRecords(PRIVATE_STORES.importBatches)
      ])
      const parsed = await parseNetflixViewingHistoryCsv(csvText, {
        viewerId: state.viewerId,
        fileName: file.name
      })
      const preview = buildNetflixImportPreview(parsed, {
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

    if (!preview || !preview.newEvents.length || preview.preview.batchAlreadyImported) {
      return
    }

    setState({ status: 'importing', error: null, success: null })

    try {
      const result = await commitPrivateImport({
        source: preview.source,
        batch: preview.batch,
        titles: preview.newTitles,
        events: preview.newEvents
      })

      await onImportComplete()
      setState({
        status: 'success',
        preview: null,
        success: result,
        error: null
      })
    } catch (error) {
      setState({ status: 'error', error, success: null })
    }
  }

  function render(storeReady) {
    const preview = state.preview
    const importDisabled = !preview
      || !preview.newEvents.length
      || preview.preview.batchAlreadyImported
      || state.status === 'importing'
    const problemSummary = preview?.preview.problems.length
      ? `${pluralize(preview.preview.problems.length, 'row')} need review: ${preview.preview.problems.slice(0, 3).map(problem => `row ${problem.row} (${problem.code})`).join(', ')}${preview.preview.problems.length > 3 ? '…' : ''}`
      : 'No parsing problems found.'

    return `
      <section class="import-section" aria-labelledby="netflix-import-heading">
        <div class="section-heading">
          <h2 id="netflix-import-heading">Import Netflix viewing history</h2>
          <p>CSV files are parsed locally. Nothing is saved until you confirm the preview.</p>
        </div>

        <div class="import-panel">
          <label>
            Viewer
            <select id="netflix-import-viewer" ${storeReady ? '' : 'disabled'}>
              ${VIEWERS.map(viewer => `
                <option value="${viewer.id}" ${viewer.id === state.viewerId ? 'selected' : ''}>
                  ${viewer.label}
                </option>
              `).join('')}
            </select>
          </label>

          <label>
            Netflix ViewingActivity CSV
            <input id="netflix-import-file" type="file" accept=".csv,text/csv" ${storeReady || state.status === 'previewing' ? '' : 'disabled'} />
          </label>

          ${state.status === 'previewing' ? '<p>Parsing local CSV for preview…</p>' : ''}
          ${state.status === 'error' ? `<p class="import-error">${state.error?.message || 'Unable to prepare the import.'}</p>` : ''}

          ${preview ? `
            <div class="import-preview">
              <strong>Preview only</strong>
              <p>${pluralize(preview.preview.recognizedRows, 'recognized row')}: ${pluralize(preview.preview.episodes, 'episode')}, ${pluralize(preview.preview.likelySeries, 'likely series', 'likely series')}, ${pluralize(preview.preview.likelyMovies, 'likely movie')}, and ${pluralize(preview.preview.ambiguous, 'ambiguous row')}.</p>
              <p>Date range: ${formatDateRange(preview.preview.dateRange)}${preview.preview.assumedLocalTime ? ' (Netflix timestamps treated as local browser time)' : ''}.</p>
              <p>${preview.preview.batchAlreadyImported
                ? 'This exact file was already imported for this viewer; no records will be added.'
                : `${pluralize(preview.preview.duplicateEvents, 'duplicate event')} will be skipped; ${pluralize(preview.preview.newEvents, 'new playback event')} can be imported.`}</p>
              <p>${problemSummary}</p>
              <button class="action-button" id="netflix-import-confirm" ${importDisabled ? 'disabled' : ''}>
                ${state.status === 'importing'
                  ? 'Importing…'
                  : `Import ${pluralize(preview.preview.newEvents, 'event')} to private storage`}
              </button>
            </div>
          ` : ''}

          ${state.status === 'success' ? `
            <p class="import-success">Imported ${pluralize(state.success.importedEvents, 'playback event')} and ${pluralize(state.success.importedTitles, 'title')}. ${pluralize(state.success.skippedEvents, 'duplicate event')} skipped.</p>
          ` : ''}
        </div>
      </section>
    `
  }

  function bind(storeReady) {
    const viewer = document.querySelector('#netflix-import-viewer')
    const file = document.querySelector('#netflix-import-file')
    const confirm = document.querySelector('#netflix-import-confirm')

    viewer?.addEventListener('change', event => {
      state = {
        status: 'idle',
        viewerId: event.target.value,
        preview: null,
        error: null,
        success: null
      }
      requestRender()
    })

    if (storeReady) {
      file?.addEventListener('change', async event => {
        await previewFile(event.target.files?.[0])
      })
    }

    confirm?.addEventListener('click', async () => {
      await commitPreview()
    })
  }

  return { bind, render }
}
