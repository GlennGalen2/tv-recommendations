import {
  PRIVATE_STORES,
  commitExplicitPreferenceImport,
  createReaction,
  getPrivatePreferenceAnalysis,
  getPrivateReactionAudit,
  listPrivateRecords,
  removeConfirmedSyntheticDemoReaction,
  supersedeReaction
} from '../data/privateStore.js'
import { previewExplicitPreferenceImport } from '../data/privatePreferences.js'

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]) }
function id() { return `rct_${crypto.randomUUID()}` }
function list(value) { return String(value || '').split(',').map(item => item.trim()).filter(Boolean) }

export function createPreferencePanel({ requestRender, onPreferenceChanged = () => {} }) {
  let state = { status: 'loading', analysis: null, titles: [], viewers: [], reactions: [], resolutions: [], preview: null, audit: null, error: null, success: null }

  async function refresh() {
    state = { ...state, status: 'loading', error: null }
    requestRender()
    try {
      const [analysis, titles, viewers, reactions, resolutions] = await Promise.all([
        getPrivatePreferenceAnalysis(), listPrivateRecords(PRIVATE_STORES.titles), listPrivateRecords(PRIVATE_STORES.viewers), listPrivateRecords(PRIVATE_STORES.reactions), listPrivateRecords(PRIVATE_STORES.identityResolutions)
      ])
      state = { ...state, status: 'ready', analysis, titles, viewers, reactions, resolutions, error: null }
    } catch { state = { ...state, status: 'error', error: 'Private preference data is unavailable in this browser.' } }
    requestRender()
  }

  function latestReaction(viewerId, titleId) {
    const superseded = new Set(state.reactions.map(reaction => reaction.supersedesReactionId).filter(Boolean))
    return state.reactions.find(reaction => reaction.viewerId === viewerId && reaction.titleId === titleId && !superseded.has(reaction.id)) || null
  }

  async function saveManual() {
    const viewerId = document.querySelector('#preference-viewer')?.value
    const titleReference = document.querySelector('#preference-title')?.value?.trim()
    const matches = state.titles.filter(title => title.id === titleReference || title.title === titleReference || title.originalTitle === titleReference)
    const titleId = matches.length === 1 ? matches[0].id : null
    const reaction = document.querySelector('#preference-reaction')?.value
    if (!viewerId || !titleId || !reaction) { state = { ...state, error: 'Enter one exact private title or title ID before saving.' }; requestRender(); return }
    const previous = latestReaction(viewerId, titleId)
    const record = {
      id: id(), schemaVersion: 1, viewerId, titleId, reaction,
      strength: Number(document.querySelector('#preference-strength')?.value || 1),
      mechanisms: { positive: list(document.querySelector('#preference-positive')?.value), negative: list(document.querySelector('#preference-negative')?.value) },
      note: document.querySelector('#preference-note')?.value?.trim() || null,
      recordedAt: new Date().toISOString(), supersedesReactionId: previous?.id || null,
      provenance: { sourceId: 'source:manual', sourceRecordId: 'private-preference-panel' }
    }
    try {
      if (previous) await supersedeReaction(record)
      else await createReaction(record)
      await refresh(); await onPreferenceChanged()
      state = { ...state, success: 'Explicit reaction saved privately.' }; requestRender()
    } catch { state = { ...state, error: 'The explicit reaction could not be saved.' }; requestRender() }
  }

  async function previewFile(file) {
    if (!file) return
    try {
      const preview = previewExplicitPreferenceImport(await file.text(), { reactions: state.reactions, titles: state.titles, resolutions: state.resolutions, viewerIds: new Set(state.viewers.map(viewer => viewer.id)), fileName: file.name })
      state = { ...state, preview, error: null, success: null }; requestRender()
    } catch { state = { ...state, preview: null, error: 'The selected file is not a valid explicit-preferences import.' }; requestRender() }
  }

  async function commitPreview() {
    if (!state.preview?.records.length) return
    try {
      const result = await commitExplicitPreferenceImport({ reactions: state.preview.records, titles: state.preview.titles })
      await refresh(); await onPreferenceChanged()
      state = { ...state, preview: null, success: `Imported ${result.imported} explicit reaction(s); ${result.importedTitles} private curated title reference(s) added; ${result.skipped} duplicate(s) skipped.` }; requestRender()
    } catch { state = { ...state, error: 'The explicit-preferences import could not be completed.' }; requestRender() }
  }

  async function inspectReactionAudit() {
    const title = document.querySelector('#preference-audit-title')?.value?.trim()
    if (!title) return
    try {
      state = { ...state, audit: { title, records: await getPrivateReactionAudit(title) }, error: null }; requestRender()
    } catch { state = { ...state, error: 'The requested private reaction audit is unavailable.' }; requestRender() }
  }

  async function removeSyntheticDemoReaction() {
    const reaction = state.reactions.find(record => record.viewerId === 'viewer-1' && record.provenance?.sourceRecordId === 'private-demo-ui')
    if (!reaction) return
    try {
      const result = await removeConfirmedSyntheticDemoReaction(reaction.id)
      await refresh(); await onPreferenceChanged()
      state = { ...state, success: `Removed the confirmed synthetic demo reaction${result.removedTitleId ? ' and its orphaned title' : ''}.` }; requestRender()
    } catch { state = { ...state, error: 'The confirmed synthetic demo reaction could not be removed.' }; requestRender() }
  }

  function render(storeReady) {
    const analysis = state.analysis
    const viewerCounts = Object.entries(analysis?.byViewer || {}).map(([viewerId, summary]) => `<p><strong>${escapeHtml(viewerId)}</strong>: ${summary.explicit} explicit · ${summary.behavioralPositive} behavioral positive · ${summary.behavioralNegative} behavioral negative</p>`).join('')
    const mechanismSummary = direction => Object.entries(analysis?.mechanisms?.[direction] || {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => `${escapeHtml(name)} (${count})`).join(', ') || 'none yet'
    const titleName = titleId => state.titles.find(title => title.id === titleId)?.title || titleId
    const anchors = (records, empty) => records.slice(0, 5).map(record => escapeHtml(titleName(record.titleId))).join(', ') || empty
    const syntheticDemoReaction = state.reactions.find(record => record.viewerId === 'viewer-1' && record.provenance?.sourceRecordId === 'private-demo-ui')
    const audit = state.audit
    const differences = (analysis?.differences || []).map(difference => ({
      title: titleName(difference.titleId),
      reactions: difference.reactions.map(record => `${record.viewerId}: ${record.reaction}`).join(' · ')
    }))
    return `<section class="import-section" aria-labelledby="preference-heading"><div class="section-heading"><h2 id="preference-heading">Private Preference Evidence</h2><p>Explicit reactions are durable and append-only. Behavioral signals are recomputed from history and remain probabilistic.</p></div><div class="import-panel">
      <button class="action-button" id="refresh-preferences" ${storeReady && state.status !== 'loading' ? '' : 'disabled'}>Refresh preference summary</button>
      ${state.status === 'loading' ? '<p>Analyzing private preferences locally…</p>' : ''}${state.error ? `<p class="import-error">${escapeHtml(state.error)}</p>` : ''}${state.success ? `<p class="import-success">${escapeHtml(state.success)}</p>` : ''}
      ${analysis ? `<div class="analysis-grid">${viewerCounts}<p><strong>${analysis.behavioral.filter(item => item.direction === 'positive').length}</strong> behavioral positive signals</p><p><strong>${analysis.behavioral.filter(item => item.direction === 'negative').length}</strong> possible early abandonments</p><p><strong>${analysis.behavioral.filter(item => item.signal === 'repeat_viewing').length}</strong> repeat-viewing signals</p><p><strong>${analysis.availabilityUncertain.length}</strong> availability-uncertain cases</p><p><strong>${analysis.conflicts.length}</strong> explicit/inferred conflicts (explicit wins)</p><p><strong>${analysis.differences.length}</strong> Viewer 1/Viewer 2 differences</p></div><p>Strongest explicit positive anchors: ${anchors(analysis.explicit.filter(record => ['loved', 'liked'].includes(record.reaction)).sort((left, right) => (right.strength || 1) - (left.strength || 1)), 'none yet')}.</p><p>Strongest explicit negative anchors: ${anchors(analysis.explicit.filter(record => ['disliked', 'abandoned'].includes(record.reaction)).sort((left, right) => (right.strength || 1) - (left.strength || 1)), 'none yet')}.</p><p>High-confidence behavioral positive anchors: ${anchors(analysis.behavioral.filter(record => record.direction === 'positive' && record.confidence >= 0.7).sort((left, right) => right.strength - left.strength), 'none yet')}.</p><p>Common positive mechanisms: ${mechanismSummary('positive')}.</p><p>Common negative mechanisms: ${mechanismSummary('negative')}.</p>` : ''}
      <div class="import-preview"><h3>Add or correct an explicit reaction</h3><label>Viewer <select id="preference-viewer">${state.viewers.map(viewer => `<option value="${escapeHtml(viewer.id)}">${escapeHtml(viewer.displayName || viewer.id)}</option>`).join('')}</select></label><label>Title or private title ID <input id="preference-title" placeholder="Enter an exact title or title ID" /></label><label>Reaction <select id="preference-reaction">${['loved','liked','okay','disliked','abandoned','unknown'].map(reaction => `<option value="${reaction}">${reaction}</option>`).join('')}</select></label><label>Strength <input id="preference-strength" type="number" min="0" max="1" step="0.1" value="1" /></label><label>Positive mechanisms (comma-separated) <input id="preference-positive" /></label><label>Negative mechanisms (comma-separated) <input id="preference-negative" /></label><label>Concise note <input id="preference-note" maxlength="500" /></label><button class="action-button" id="save-preference" ${storeReady ? '' : 'disabled'}>Save explicit reaction</button></div>
      <div class="import-preview"><h3>Import curated explicit preferences</h3><p>JSON is parsed locally, previewed, and saved only after confirmation. Records may use a private <code>titleId</code> or a human-readable <code>title</code> with optional <code>year</code>, <code>mediaType</code>, and <code>tmdbId</code>. Raw file contents are never stored.</p><input id="preference-import-file" type="file" accept="application/json,.json" ${storeReady ? '' : 'disabled'} />${state.preview ? `<p>${state.preview.summary.sourceRecords} source records; ${state.preview.summary.importable} safe to import; ${state.preview.summary.curatedTitles} new private curated references; ${state.preview.summary.duplicates} duplicates skipped.</p>${state.preview.previewRecords.slice(0, 20).map(record => `<p>${escapeHtml(record.suppliedTitle || 'private title ID')}: <strong>${escapeHtml(record.status)}</strong>${record.resolvedIdentity?.title ? ` → ${escapeHtml(record.resolvedIdentity.title)}` : ''} · ${escapeHtml(record.reaction)}</p>`).join('')}${state.preview.summary.problems.length ? `<p class="import-error">${escapeHtml(state.preview.summary.problems.join(' '))}</p>` : ''}<button class="action-button" id="confirm-preference-import" ${state.preview.records.length ? '' : 'disabled'}>Import explicit preferences</button>` : ''}</div>
      <div class="import-preview"><h3>Private preference maintenance</h3><p>Inspect an exact title's append-only reaction history locally.</p><label>Exact title <input id="preference-audit-title" value="${escapeHtml(audit?.title || '')}" /></label><button class="action-button" id="inspect-preference-audit" ${storeReady ? '' : 'disabled'}>Inspect reaction history</button>${audit ? (audit.records.length ? audit.records.map(record => `<p><strong>${escapeHtml(record.viewer)}</strong>: ${escapeHtml(record.reaction)} · ${record.current ? 'current' : 'superseded'} · ${escapeHtml(record.provenance?.sourceRecordId || 'no source record')}</p>`).join('') : '<p>No matching private reactions.</p>') : ''}${differences.length ? `<p>Current Viewer 1 / Viewer 2 difference: ${differences.map(difference => `${escapeHtml(difference.title)} (${escapeHtml(difference.reactions)})`).join('; ')}</p>` : ''}${syntheticDemoReaction ? '<p>A confirmed synthetic private-demo reaction is present.</p><button class="action-button" id="remove-synthetic-demo-reaction">Remove confirmed synthetic demo reaction</button>' : ''}</div>
    </div></section>`
  }
  function bind(storeReady) {
    if (!storeReady) return
    document.querySelector('#refresh-preferences')?.addEventListener('click', refresh)
    document.querySelector('#save-preference')?.addEventListener('click', saveManual)
    document.querySelector('#preference-import-file')?.addEventListener('change', event => previewFile(event.target.files?.[0]))
    document.querySelector('#confirm-preference-import')?.addEventListener('click', commitPreview)
    document.querySelector('#inspect-preference-audit')?.addEventListener('click', inspectReactionAudit)
    document.querySelector('#remove-synthetic-demo-reaction')?.addEventListener('click', removeSyntheticDemoReaction)
  }
  return { bind, render, refresh }
}
