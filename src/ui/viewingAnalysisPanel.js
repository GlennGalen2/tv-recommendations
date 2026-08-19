import { getPrivateViewingAnalysis } from '../data/privateStore.js'

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character])
}

function formatDateRange(range) {
  return range ? `${range.earliest} to ${range.latest}` : 'No playback dates available'
}

function summaryList(summaries, emptyMessage) {
  return summaries.length
    ? `<ul class="analysis-list">${summaries.map(summary => `
        <li><strong>${escapeHtml(summary.canonicalTitle || summary.sourceTitles[0] || 'Unidentified title')}</strong>
          <span>${summary.playbackEventCount} playback event${summary.playbackEventCount === 1 ? '' : 's'} · ${escapeHtml(summary.services.join(', '))}${summary.repeatPlaybackDetected ? ' · repeat detected' : ''}</span>
        </li>`).join('')}</ul>`
    : `<p class="empty-message">${emptyMessage}</p>`
}

export function createViewingAnalysisPanel({ requestRender }) {
  let state = { status: 'loading', analysis: null }

  async function refresh() {
    state = { status: 'loading', analysis: state.analysis }
    requestRender()
    try {
      state = { status: 'ready', analysis: await getPrivateViewingAnalysis() }
    } catch {
      state = { status: 'error', analysis: null }
    }
    requestRender()
  }

  function render(storeReady) {
    const analysis = state.analysis
    const totals = analysis?.totals

    return `
      <section class="import-section" aria-labelledby="viewing-analysis-heading">
        <div class="section-heading">
          <h2 id="viewing-analysis-heading">Private Viewing History Analysis</h2>
          <p>Derived locally from immutable playback events. Viewing volume does not indicate liking.</p>
        </div>
        <div class="import-panel">
          <button class="action-button" id="refresh-viewing-analysis" ${storeReady && state.status !== 'loading' ? '' : 'disabled'}>Refresh analysis</button>
          ${state.status === 'loading' ? '<p>Analyzing private viewing history locally…</p>' : ''}
          ${state.status === 'error' ? '<p class="import-error">Private viewing analysis is unavailable in this browser.</p>' : ''}
          ${totals ? `
            <div class="analysis-grid">
              <p><strong>${totals.playbackEvents}</strong> playback events</p>
              <p><strong>${totals.distinctNormalizedTitles}</strong> distinct normalized titles</p>
              <p><strong>${totals.knownSeries}</strong> known series · <strong>${totals.knownMovies}</strong> known movies</p>
              <p><strong>${totals.unresolvedTitles}</strong> unresolved TV/title records</p>
              <p>Date range: ${formatDateRange(totals.dateRange)}</p>
              <p>Sources: ${Object.entries(totals.sourceEventCounts).map(([source, count]) => `${escapeHtml(source)} ${count}`).join(', ') || 'none'}</p>
            </div>
            <div class="analysis-columns">
              <div><h3>Most viewed titles</h3>${summaryList(analysis.mostViewed, 'No playback events yet.')}</div>
              <div><h3>Multi-source titles</h3>${summaryList(analysis.multiSourceTitles, 'No reliable cross-source matches yet.')}</div>
              <div><h3>Needs metadata enrichment</h3>${summaryList(analysis.unresolvedReferences, 'No unresolved title records.')}</div>
            </div>
          ` : ''}
        </div>
      </section>
    `
  }

  function bind(storeReady) {
    if (storeReady) document.querySelector('#refresh-viewing-analysis')?.addEventListener('click', refresh)
  }

  return { bind, render, refresh }
}
