import {
  createIdentityResolution,
  getPrivateIdentityResolutionReview,
  undoIdentityResolution
} from '../data/privateStore.js'
import {
  filterAndSortIdentityReviewQueue,
  paginateIdentityReviewQueue,
  runTmdbIdentityReviewQueue,
  summarizeIdentityReviewQueue
} from '../data/tmdbMatchingPilot.js'

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character])
}

function newResolutionId() {
  return `resolution_${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
}

function categoryLabel(category) {
  return {
    'needs-review': 'Needs review',
    unresolved: 'Unresolved / no adequate candidate',
    confirmed: 'Confirmed',
    rejected: 'Rejected',
    'previously-resolved': 'Previously resolved'
  }[category] || category
}

export function createIdentityResolutionPanel({ requestRender, onIdentityResolutionChanged = () => {} }) {
  let state = { status: 'loading', review: null, queue: null, filter: 'needs-review', sort: 'priority', page: 0, error: null, progress: null }

  async function refresh() {
    state = { ...state, status: 'loading', error: null }
    requestRender()
    try {
      state = { ...state, status: 'ready', review: await getPrivateIdentityResolutionReview(), error: null }
    } catch {
      state = { ...state, status: 'error', review: null, error: 'Private identity-resolution data is unavailable in this browser.' }
    }
    requestRender()
  }

  async function runQueue(retryRemaining = false) {
    const pendingTitleIds = retryRemaining ? state.queue?.pendingTitleIds : null
    state = { ...state, status: 'running-queue', error: null, progress: { processed: 0, total: pendingTitleIds?.length || 0 } }
    requestRender()
    try {
      const queue = await runTmdbIdentityReviewQueue({
        eligibleTitleIds: pendingTitleIds,
        previousItems: retryRemaining ? state.queue?.items || [] : [],
        onProgress: async progress => {
          state = { ...state, progress }
          requestRender()
        }
      })
      state = { ...state, status: 'ready', queue, filter: 'needs-review', page: 0, progress: null }
    } catch {
      state = { ...state, status: 'ready', error: 'The matching queue could not complete. No private title or resolution was changed.', progress: null }
    }
    requestRender()
  }

  async function recordDecision(item, candidate, status) {
    if (!item || !candidate) return
    try {
      const resolutionId = await createIdentityResolution({
        id: newResolutionId(), schemaVersion: 1, sourceTitleId: item.titleId, status,
        candidate, confidence: candidate.score ?? 0,
        resolutionMethod: status === 'manually-confirmed' ? 'manual-confirmation' : 'manual-rejection',
        rationale: candidate.reasons || ['Explicit private review decision.'],
        recordedAt: new Date().toISOString(), supersedesResolutionId: item.resolution?.id || null
      })
      const category = status === 'manually-confirmed' ? 'confirmed' : 'rejected'
      if (state.queue) {
        const items = state.queue.items.map(queueItem => queueItem.titleId === item.titleId ? { ...queueItem, category, state: category, resolution: { id: resolutionId, status, candidate } } : queueItem)
        state = { ...state, queue: { ...state.queue, items, counts: summarizeIdentityReviewQueue(items) } }
      }
      await refresh()
      await onIdentityResolutionChanged()
    } catch {
      state = { ...state, error: 'The explicit identity decision could not be saved.' }
      requestRender()
    }
  }

  async function undoDecision(item) {
    if (!item?.resolution?.id) return
    try {
      await undoIdentityResolution(item.resolution.id)
      if (state.queue) {
        const items = state.queue.items.map(queueItem => queueItem.titleId === item.titleId ? { ...queueItem, category: 'unresolved', state: 'unresolved', resolution: null, bestCandidate: null } : queueItem)
        state = { ...state, queue: { ...state.queue, items, counts: summarizeIdentityReviewQueue(items) } }
      }
      await refresh()
      await onIdentityResolutionChanged()
    } catch {
      state = { ...state, error: 'The prior identity decision could not be undone.' }
      requestRender()
    }
  }

  function setFilter(filter) { state = { ...state, filter, page: 0 }; requestRender() }
  function setSort(sort) { state = { ...state, sort, page: 0 }; requestRender() }
  function setPage(page) { state = { ...state, page }; requestRender() }

  function queueItem(item) {
    const candidate = item.bestCandidate
    const alternate = item.alternateCandidates.length
      ? `<span>Alternates: ${item.alternateCandidates.map((alternateCandidate, index) => `${escapeHtml(alternateCandidate.canonicalTitle)} (${Math.round(alternateCandidate.score * 100)}%) <button class="small-button confirm-alternate" data-title-id="${escapeHtml(item.titleId)}" data-alternate-index="${index}">Confirm</button>`).join(' · ')}</span>`
      : ''
    const lookup = item.lookupNormalization.applied
      ? `<span>TMDb search title: <strong>${escapeHtml(item.searchTitle)}</strong> · ${escapeHtml(item.lookupNormalization.transformation)}. ${escapeHtml(item.lookupNormalization.reason)}</span>`
      : ''
    const controls = item.category === 'needs-review'
      ? `<span><button class="small-button confirm-resolution" data-title-id="${escapeHtml(item.titleId)}">Confirm proposed identity</button> <button class="small-button reject-resolution" data-title-id="${escapeHtml(item.titleId)}">Reject</button></span>`
      : ['confirmed', 'rejected', 'previously-resolved'].includes(item.category)
        ? `<span><button class="small-button undo-resolution" data-title-id="${escapeHtml(item.titleId)}">Undo / correct</button></span>`
        : ''
    return `<li><strong>${escapeHtml(item.sourceTitle)}</strong>
      <span>${escapeHtml(item.sourceNames.join(', ') || 'Unknown source')} · existing ${escapeHtml(item.existingType)}</span>
      <span><strong>${escapeHtml(categoryLabel(item.category))}</strong>${candidate ? ` · ${escapeHtml(candidate.canonicalTitle)} · ${escapeHtml(candidate.mediaType)}${candidate.releaseYear ? ` · ${candidate.releaseYear}` : ''} · ${Math.round((candidate.score || item.resolution?.confidence || 0) * 100)}% · ${escapeHtml((candidate.reasons || []).join(' '))}` : ''}</span>
      ${alternate}${lookup}${item.error ? `<span>${escapeHtml(item.error)}</span>` : ''}${controls}
    </li>`
  }

  function render(storeReady) {
    const counts = state.review?.counts
    const queue = state.queue
    const queueCounts = queue?.counts
    const sortedItems = queue ? filterAndSortIdentityReviewQueue(queue.items, { category: state.filter, sort: state.sort }) : []
    const pagination = paginateIdentityReviewQueue(sortedItems, state.page)
    return `
      <section class="import-section" aria-labelledby="identity-resolution-heading">
        <div class="section-heading"><h2 id="identity-resolution-heading">Private Identity Resolution Review</h2><p>Matching results are recomputable browser-local review material. Only an explicit confirmation, rejection, or undo writes an append-only private resolution record.</p></div>
        <div class="import-panel">
          <button class="action-button" id="refresh-identity-resolution" ${storeReady && state.status !== 'loading' && state.status !== 'running-queue' ? '' : 'disabled'}>Refresh resolution status</button>
          ${state.status === 'loading' ? '<p>Reading private resolution state locally…</p>' : ''}
          ${state.status === 'running-queue' ? `<p>Matching locally: ${state.progress?.processed || 0} of ${state.progress?.total || 'eligible'} eligible records. Candidate results are not being saved.</p>` : ''}
          ${state.error ? `<p class="import-error">${escapeHtml(state.error)}</p>` : ''}
          ${counts ? `<div class="analysis-grid"><p><strong>${counts.unresolved}</strong> unresolved</p><p><strong>${counts.manuallyConfirmed}</strong> confirmed</p><p><strong>${counts.manuallyRejected}</strong> rejected</p><p><strong>${counts.confidentlyResolved + counts.candidateMatch}</strong> previously resolved</p></div>` : ''}
          <div class="import-preview">
            <h3>TMDb review queue</h3><p>Runs against every eligible private title record with sequential throttling. A 429 response stops safely; retrying only re-queries remaining records.</p>
            <button class="action-button" id="run-tmdb-review-queue" ${storeReady && state.status !== 'loading' && state.status !== 'running-queue' ? '' : 'disabled'}>${state.status === 'running-queue' ? 'Matching queue…' : 'Run full matching queue'}</button>
            ${queue?.pendingTitleIds.length ? '<button class="action-button" id="retry-tmdb-review-queue">Retry remaining records</button>' : ''}
            ${queueCounts ? `<div class="analysis-grid"><p><strong>${queue.eligibleCount}</strong> eligible · <strong>${queue.processedCount}</strong> processed this run</p><p><strong>${queueCounts['needs-review']}</strong> needs review</p><p><strong>${queueCounts.unresolved}</strong> unresolved</p><p><strong>${queueCounts.confirmed}</strong> confirmed</p><p><strong>${queueCounts.rejected}</strong> rejected</p><p><strong>${queueCounts['previously-resolved']}</strong> previously resolved</p><p><strong>${queueCounts.normalizedLookups}</strong> normalized lookups</p><p><strong>${queueCounts.noCandidateCases}</strong> no-candidate cases</p></div>${queue.haltedReason ? `<p class="import-error">${escapeHtml(queue.haltedReason)}</p>` : ''}` : ''}
            ${queue ? `<div class="actions"><button class="small-button queue-filter" data-queue-filter="all">All</button><button class="small-button queue-filter" data-queue-filter="needs-review">Needs review</button><button class="small-button queue-filter" data-queue-filter="unresolved">Unresolved</button><button class="small-button queue-filter" data-queue-filter="confirmed">Confirmed</button><button class="small-button queue-filter" data-queue-filter="rejected">Rejected</button><button class="small-button queue-filter" data-queue-filter="previously-resolved">Previously resolved</button><label>Sort <select id="queue-sort"><option value="priority" ${state.sort === 'priority' ? 'selected' : ''}>Review priority</option><option value="confidence" ${state.sort === 'confidence' ? 'selected' : ''}>Confidence</option><option value="title" ${state.sort === 'title' ? 'selected' : ''}>Source title</option></select></label></div><ul class="analysis-list">${pagination.items.map(queueItem).join('')}</ul><div class="actions"><button class="small-button" id="queue-previous" ${pagination.page === 0 ? 'disabled' : ''}>Previous</button><span>Page ${pagination.page + 1} of ${pagination.pageCount}</span><button class="small-button" id="queue-next" ${pagination.page >= pagination.pageCount - 1 ? 'disabled' : ''}>Next</button></div>` : ''}
          </div>
        </div>
      </section>`
  }

  function bind(storeReady) {
    if (!storeReady) return
    document.querySelector('#refresh-identity-resolution')?.addEventListener('click', refresh)
    document.querySelector('#run-tmdb-review-queue')?.addEventListener('click', () => runQueue())
    document.querySelector('#retry-tmdb-review-queue')?.addEventListener('click', () => runQueue(true))
    document.querySelectorAll('.queue-filter').forEach(button => button.addEventListener('click', () => setFilter(button.dataset.queueFilter)))
    document.querySelector('#queue-sort')?.addEventListener('change', event => setSort(event.currentTarget.value))
    document.querySelector('#queue-previous')?.addEventListener('click', () => setPage(state.page - 1))
    document.querySelector('#queue-next')?.addEventListener('click', () => setPage(state.page + 1))
    document.querySelectorAll('.confirm-resolution').forEach(button => button.addEventListener('click', () => { const item = state.queue?.items.find(queueItem => queueItem.titleId === button.dataset.titleId); recordDecision(item, item?.bestCandidate, 'manually-confirmed') }))
    document.querySelectorAll('.reject-resolution').forEach(button => button.addEventListener('click', () => { const item = state.queue?.items.find(queueItem => queueItem.titleId === button.dataset.titleId); recordDecision(item, item?.bestCandidate, 'manually-rejected') }))
    document.querySelectorAll('.confirm-alternate').forEach(button => button.addEventListener('click', () => { const item = state.queue?.items.find(queueItem => queueItem.titleId === button.dataset.titleId); recordDecision(item, item?.alternateCandidates[Number(button.dataset.alternateIndex)], 'manually-confirmed') }))
    document.querySelectorAll('.undo-resolution').forEach(button => button.addEventListener('click', () => undoDecision(state.queue?.items.find(queueItem => queueItem.titleId === button.dataset.titleId))))
  }

  return { bind, render, refresh }
}
