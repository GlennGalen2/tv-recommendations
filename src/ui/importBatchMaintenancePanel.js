import {
  getPrivateImportBatches,
  removePrivateImportBatch
} from '../data/privateStore.js'

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character])
}

function formatDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Unknown import date' : date.toLocaleString()
}

function batchFingerprint(batch) {
  return batch.sourceHash?.value?.slice(0, 12) || batch.id.slice(-12)
}

export function createImportBatchMaintenancePanel({ requestRender, onRemovalComplete }) {
  let state = { status: 'loading', batches: [], selectedId: null, confirming: false, error: null, success: null }

  async function refresh() {
    state = { ...state, status: 'loading', error: null }
    requestRender()
    try {
      state = { ...state, status: 'ready', batches: await getPrivateImportBatches() }
    } catch {
      state = { ...state, status: 'error', error: 'Imported-data maintenance is unavailable in this browser.' }
    }
    requestRender()
  }

  function selectBatch(id) {
    state = { ...state, selectedId: id, confirming: false, success: null, error: null }
    requestRender()
  }

  async function removeSelectedBatch() {
    if (!state.selectedId || !state.confirming) return
    state = { ...state, status: 'removing', error: null, success: null }
    requestRender()
    try {
      const result = await removePrivateImportBatch(state.selectedId)
      await onRemovalComplete()
      state = {
        status: 'ready',
        batches: await getPrivateImportBatches(),
        selectedId: null,
        confirming: false,
        error: null,
        success: result
      }
    } catch {
      state = { ...state, status: 'ready', error: 'The selected import batch could not be removed. No partial removal was applied.' }
    }
    requestRender()
  }

  function render(storeReady) {
    const selected = state.batches.find(batch => batch.id === state.selectedId)

    return `
      <section class="import-section" aria-labelledby="imported-data-heading">
        <div class="section-heading">
          <h2 id="imported-data-heading">Imported data maintenance</h2>
          <p>Use batch provenance to roll back an entire import. No raw CSV contents are retained or shown.</p>
        </div>
        <div class="import-panel">
          <button class="action-button" id="refresh-import-batches" ${storeReady && state.status !== 'loading' && state.status !== 'removing' ? '' : 'disabled'}>Refresh imported data</button>
          ${state.status === 'loading' ? '<p>Reading local import provenance…</p>' : ''}
          ${state.error ? `<p class="import-error">${state.error}</p>` : ''}
          ${state.success ? `<p class="import-success">Removed ${state.success.removedHistoryEvents} history event${state.success.removedHistoryEvents === 1 ? '' : 's'} and ${state.success.removedTitles} no-longer-referenced title${state.success.removedTitles === 1 ? '' : 's'}.</p>` : ''}
          ${state.batches.length ? `
            <ul class="analysis-list">
              ${state.batches.map(batch => `<li>
                <strong>${escapeHtml(batch.sourceName)}</strong>
                <span>${escapeHtml(batch.sourceFileName || 'Filename unavailable')} · Viewer ${escapeHtml(batch.viewerId || 'unknown')} · ${batch.historyEventCount} history events · ${escapeHtml(batch.importerVersion || 'unknown importer')} · ${formatDate(batch.importedAt)} · fingerprint ${escapeHtml(batchFingerprint(batch))}</span>
                <button class="action-button batch-select" data-batch-id="${escapeHtml(batch.id)}">Inspect removal</button>
              </li>`).join('')}
            </ul>
          ` : state.status === 'ready' ? '<p class="empty-message">No private import batches are recorded.</p>' : ''}
          ${selected ? `
            <div class="import-preview">
              <strong>Selected batch</strong>
              <p>${escapeHtml(selected.sourceName)} · ${escapeHtml(selected.sourceFileName || 'Filename unavailable')} · ${selected.historyEventCount} history events · fingerprint ${escapeHtml(batchFingerprint(selected))}.</p>
              <p class="restore-warning">Removing this batch permanently deletes only history events whose provenance names this batch. Titles are deleted only when no remaining private record references them.</p>
              ${state.confirming
                ? `<button class="action-button" id="confirm-remove-import-batch" ${state.status === 'removing' ? 'disabled' : ''}>${state.status === 'removing' ? 'Removing…' : 'Confirm permanent batch removal'}</button>`
                : '<button class="action-button" id="prepare-remove-import-batch">Continue to removal confirmation</button>'}
            </div>
          ` : ''}
        </div>
      </section>
    `
  }

  function bind(storeReady) {
    if (!storeReady) return
    document.querySelector('#refresh-import-batches')?.addEventListener('click', refresh)
    document.querySelectorAll('.batch-select').forEach(button => {
      button.addEventListener('click', () => selectBatch(button.dataset.batchId))
    })
    document.querySelector('#prepare-remove-import-batch')?.addEventListener('click', () => {
      state = { ...state, confirming: true }
      requestRender()
    })
    document.querySelector('#confirm-remove-import-batch')?.addEventListener('click', removeSelectedBatch)
  }

  return { bind, render, refresh }
}
