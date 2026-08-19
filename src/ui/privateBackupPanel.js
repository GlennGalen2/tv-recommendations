import {
  exportPrivateBackup,
  inspectPrivateBackupJson,
  restorePrivateBackup
} from '../data/privateStore.js'

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function formatCount(count) {
  return `${count} ${count === 1 ? 'record' : 'records'}`
}

function formatBackupDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Unknown date' : date.toLocaleString()
}

export function createPrivateBackupPanel({ requestRender, onRestoreComplete }) {
  let state = {
    status: 'idle',
    preview: null,
    backup: null,
    validationProblems: [],
    error: null,
    success: null
  }

  function setState(next) {
    state = { ...state, ...next }
    requestRender()
  }

  async function exportBackup() {
    setState({ status: 'exporting', error: null, success: null })

    try {
      const backup = await exportPrivateBackup()
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json'
      })
      const link = document.createElement('a')
      const objectUrl = URL.createObjectURL(blob)
      link.href = objectUrl
      link.download = `tv-recommendations-private-backup-${timestampForFile()}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
      setState({ status: 'exported', success: { recordCounts: backup.recordCounts } })
    } catch {
      setState({ status: 'error', error: 'Backup export could not be completed.' })
    }
  }

  async function previewRestoreFile(file) {
    if (!file) {
      return
    }

    setState({ status: 'previewing-restore', preview: null, backup: null, validationProblems: [], error: null, success: null })

    try {
      const { backup, validation } = inspectPrivateBackupJson(await file.text())
      setState({
        status: validation.valid ? 'restore-preview' : 'invalid-restore-preview',
        backup: validation.valid ? backup : null,
        preview: validation.preview,
        validationProblems: validation.problems
      })
    } catch {
      setState({ status: 'error', error: 'The selected file is not valid JSON.' })
    }
  }

  async function restoreBackup() {
    if (!state.backup) {
      return
    }

    setState({ status: 'restoring', error: null, success: null })

    try {
      const result = await restorePrivateBackup(state.backup)
      await onRestoreComplete()
      setState({ status: 'restored', preview: null, backup: null, success: result })
    } catch {
      setState({ status: 'error', error: 'Restore failed. Current private data was not replaced.' })
    }
  }

  function render(storeReady) {
    const counts = state.preview?.recordCounts || state.success?.recordCounts
    const countSummary = counts
      ? Object.values(counts).reduce((total, count) => total + count, 0)
      : 0

    return `
      <section class="import-section" aria-labelledby="private-backup-heading">
        <div class="section-heading">
          <h2 id="private-backup-heading">Private data backup</h2>
          <p>Backups are downloaded and restored locally; this app does not upload them.</p>
        </div>

        <div class="import-panel">
          <button class="action-button" id="private-backup-export" ${storeReady && state.status !== 'exporting' ? '' : 'disabled'}>
            ${state.status === 'exporting' ? 'Preparing backup…' : 'Download private-data backup'}
          </button>

          <label class="backup-file-label">
            Restore from a private-data backup
            <input id="private-backup-file" type="file" accept="application/json,.json" ${storeReady || state.status === 'previewing-restore' ? '' : 'disabled'} />
          </label>

          ${state.status === 'previewing-restore' ? '<p>Validating selected backup locally…</p>' : ''}
          ${state.error ? `<p class="import-error">${state.error}</p>` : ''}
          ${state.status === 'exported' ? `<p class="import-success">Downloaded backup with ${formatCount(countSummary)}.</p>` : ''}
          ${state.status === 'restored' ? `<p class="import-success">Restored ${formatCount(countSummary)} from the selected backup.</p>` : ''}

          ${state.validationProblems.length ? `<p class="import-error">Backup validation: ${state.validationProblems.join(' ')}</p>` : ''}

          ${state.preview && state.backup ? `
            <div class="import-preview">
              <strong>Restore preview</strong>
              <p>Backup date: ${formatBackupDate(state.preview.exportedAt)}. Database schema: ${state.preview.databaseVersion}; record schema: ${state.preview.recordSchemaVersion}.</p>
              <p>${formatCount(countSummary)} across ${Object.entries(state.preview.recordCounts).map(([store, count]) => `${store}: ${count}`).join(', ')}.</p>
              <p class="restore-warning">Confirming will permanently replace the private IndexedDB data currently stored in this browser. This backup is not merged with existing records.</p>
              <button class="action-button" id="private-backup-restore" ${state.status === 'restoring' ? 'disabled' : ''}>
                ${state.status === 'restoring' ? 'Replacing private data…' : 'Replace private data from this backup'}
              </button>
            </div>
          ` : ''}
        </div>
      </section>
    `
  }

  function bind(storeReady) {
    document.querySelector('#private-backup-export')?.addEventListener('click', exportBackup)

    if (storeReady) {
      document.querySelector('#private-backup-file')?.addEventListener('change', async event => {
        await previewRestoreFile(event.target.files?.[0])
      })
    }

    document.querySelector('#private-backup-restore')?.addEventListener('click', restoreBackup)
  }

  return { bind, render }
}
