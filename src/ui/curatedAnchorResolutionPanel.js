import { createIdentityResolution, undoIdentityResolution } from '../data/privateStore.js'
import { runCuratedAnchorResolution } from '../data/curatedAnchorResolution.js'

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]))
}

function newResolutionId() {
  return `resolution_${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
}

export function createCuratedAnchorResolutionPanel({ requestRender, onIdentityResolutionChanged = () => {} }) {
  let state = { status: 'ready', queue: null, error: null, progress: null }

  async function run() {
    state = { ...state, status: 'running', error: null, progress: { processed: 0, total: 0 } }
    requestRender()
    try {
      state = { ...state, queue: await runCuratedAnchorResolution({ onProgress: progress => { state = { ...state, progress }; requestRender() } }), status: 'ready', progress: null }
    } catch {
      state = { ...state, status: 'ready', error: 'The curated-anchor match could not complete. No private preference or identity resolution was changed.', progress: null }
    }
    requestRender()
  }

  async function decide(item, candidate, status) {
    if (!item || !candidate) return
    try {
      const resolutionId = await createIdentityResolution({
        id: newResolutionId(), schemaVersion: 1, sourceTitleId: item.titleId, status, candidate,
        confidence: candidate.score ?? 0,
        resolutionMethod: status === 'manually-confirmed' ? 'manual-confirmation' : 'manual-rejection',
        rationale: candidate.reasons || ['Explicit private curated-anchor review decision.'],
        recordedAt: new Date().toISOString(), supersedesResolutionId: item.resolution?.id || null
      })
      const category = status === 'manually-confirmed' ? 'confirmed' : 'rejected'
      const items = state.queue.items.map(current => current.titleId === item.titleId ? { ...current, category, state: category, resolution: { id: resolutionId, status, candidate } } : current)
      state = { ...state, queue: { ...state.queue, items } }
      await onIdentityResolutionChanged()
    } catch {
      state = { ...state, error: 'The explicit identity decision could not be saved.' }
    }
    requestRender()
  }

  async function undo(item) {
    if (!item?.resolution?.id) return
    try {
      await undoIdentityResolution(item.resolution.id)
      state = { ...state, queue: null }
      await onIdentityResolutionChanged()
    } catch {
      state = { ...state, error: 'The prior identity decision could not be undone.' }
    }
    requestRender()
  }

  function reactionSummary(reactions) {
    return reactions.map(reaction => `${reaction.viewerId === 'viewer-1' ? 'Viewer 1' : 'Viewer 2'} ${reaction.reaction}`).join(' · ')
  }

  function itemView(item) {
    const candidate = item.bestCandidate
    const alternates = item.alternateCandidates?.length
      ? `<span>Alternates: ${item.alternateCandidates.map((alternate, index) => `${escapeHtml(alternate.canonicalTitle)} (${Math.round(alternate.score * 100)}%) <button class="small-button curated-confirm-alternate" data-title-id="${escapeHtml(item.titleId)}" data-alternate-index="${index}">Confirm</button>`).join(' · ')}</span>` : ''
    const controls = item.category === 'needs-review'
      ? `<span><button class="small-button curated-confirm" data-title-id="${escapeHtml(item.titleId)}">Confirm proposed identity</button> <button class="small-button curated-reject" data-title-id="${escapeHtml(item.titleId)}">Reject</button></span>`
      : ['confirmed', 'rejected', 'previously-resolved'].includes(item.category)
        ? `<span><button class="small-button curated-undo" data-title-id="${escapeHtml(item.titleId)}">Undo / correct</button></span>` : ''
    return `<li><strong>${escapeHtml(item.sourceTitle)}</strong>
      <span>${escapeHtml(reactionSummary(item.reactions || []))} · existing ${escapeHtml(item.existingType)}</span>
      <span><strong>${escapeHtml(item.category.replaceAll('-', ' '))}</strong>${candidate ? ` · ${escapeHtml(candidate.canonicalTitle)} · ${escapeHtml(candidate.mediaType)}${candidate.releaseYear ? ` · ${candidate.releaseYear}` : ''} · TMDb ${escapeHtml(candidate.externalId)} · ${Math.round((candidate.score || item.resolution?.confidence || 0) * 100)}% · ${escapeHtml((candidate.reasons || []).join(' '))}` : ''}</span>
      ${alternates}${item.error ? `<span>${escapeHtml(item.error)}</span>` : ''}${controls}
    </li>`
  }

  function render(storeReady) {
    const queue = state.queue
    const counts = queue?.counts
    return `<section class="import-section" aria-labelledby="curated-anchor-resolution-heading">
      <div class="section-heading"><h2 id="curated-anchor-resolution-heading">Curated Preference Anchor Resolution</h2><p>Matches only the highest-value private explicit-preference anchors. Results are transient review material; confirmation is always explicit and append-only.</p></div>
      <div class="import-panel"><button class="action-button" id="run-curated-anchor-resolution" ${storeReady && state.status !== 'running' ? '' : 'disabled'}>${state.status === 'running' ? `Matching ${state.progress?.processed || 0} of ${state.progress?.total || 'selected'} anchors…` : 'Match curated preference anchors'}</button>
      ${state.error ? `<p class="import-error">${escapeHtml(state.error)}</p>` : ''}
      ${queue ? `<div class="analysis-grid"><p><strong>${queue.selectedCount}</strong> selected anchors</p><p><strong>${queue.eligibleCount}</strong> newly matched</p><p><strong>${counts['needs-review']}</strong> ready for review</p><p><strong>${counts.unresolved}</strong> unresolved</p><p><strong>${counts.noCandidateCases}</strong> no candidate</p><p><strong>${counts.ambiguousMatches}</strong> with alternates</p></div><ul class="analysis-list">${queue.items.map(itemView).join('')}</ul>` : '<p>Selects up to 25 existing curated anchors by current explicit reaction strength, mechanism coverage, and relevance to both viewers. No matching runs until you choose the button.</p>'}
      </div></section>`
  }

  function bind(storeReady) {
    if (!storeReady) return
    document.querySelector('#run-curated-anchor-resolution')?.addEventListener('click', run)
    document.querySelectorAll('.curated-confirm').forEach(button => button.addEventListener('click', () => { const item = state.queue?.items.find(record => record.titleId === button.dataset.titleId); decide(item, item?.bestCandidate, 'manually-confirmed') }))
    document.querySelectorAll('.curated-reject').forEach(button => button.addEventListener('click', () => { const item = state.queue?.items.find(record => record.titleId === button.dataset.titleId); decide(item, item?.bestCandidate, 'manually-rejected') }))
    document.querySelectorAll('.curated-confirm-alternate').forEach(button => button.addEventListener('click', () => { const item = state.queue?.items.find(record => record.titleId === button.dataset.titleId); decide(item, item?.alternateCandidates[Number(button.dataset.alternateIndex)], 'manually-confirmed') }))
    document.querySelectorAll('.curated-undo').forEach(button => button.addEventListener('click', () => undo(state.queue?.items.find(record => record.titleId === button.dataset.titleId))))
  }

  return { bind, render }
}
