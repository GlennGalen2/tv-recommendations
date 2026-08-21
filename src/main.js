import './style.css'
import catalog from '../data/v1/catalog/titles.json'
import recommendationData from '../data/v1/recommendations/recommendations.json'
import {
  PRIVATE_STORES,
  createHistoryEvent,
  createPrivateRecord,
  createReaction,
  initializePrivateStore,
  listPrivateRecords,
  readPrivateRecord,
  supersedeReaction
} from './data/privateStore.js'
import { createNetflixImportPanel } from './ui/netflixImportPanel.js'
import { createAmazonPrimeImportPanel } from './ui/amazonPrimeImportPanel.js'
import { createPrivateBackupPanel } from './ui/privateBackupPanel.js'
import { createViewingAnalysisPanel } from './ui/viewingAnalysisPanel.js'
import { createImportBatchMaintenancePanel } from './ui/importBatchMaintenancePanel.js'
import { createIdentityResolutionPanel } from './ui/identityResolutionPanel.js'
import { createTmdbCredentialPanel } from './ui/tmdbCredentialPanel.js'
import { createPreferencePanel } from './ui/preferencePanel.js'
import { createRecommendationEnginePanel } from './ui/recommendationEnginePanel.js'
import { createCuratedAnchorResolutionPanel } from './ui/curatedAnchorResolutionPanel.js'
import { createDiscoveredRecommendationsPanel } from './ui/discoveredRecommendationsPanel.js'
import { createRecommendationHomePanel } from './ui/recommendationHomePanel.js'

const titlesById = new Map(
  catalog.titles.map(title => [title.id, title])
)

const DEMO_UI_STATE_KEY = 'tv-app-demo-ui-state-v1'
const PRIVATE_DEMO_VIEWER_ID = 'viewer-1'

let privateDemoState = {
  status: 'loading',
  error: null,
  watchedTitleIds: new Set(),
  reactionsByTitle: new Map()
}

const netflixImportPanel = createNetflixImportPanel({
  requestRender: render,
  onImportComplete: refreshPrivateDataViews
})

const amazonPrimeImportPanel = createAmazonPrimeImportPanel({
  requestRender: render,
  onImportComplete: refreshPrivateDataViews
})

const privateBackupPanel = createPrivateBackupPanel({
  requestRender: render,
  onRestoreComplete: refreshPrivateDataViews
})

const viewingAnalysisPanel = createViewingAnalysisPanel({ requestRender: render })
const importBatchMaintenancePanel = createImportBatchMaintenancePanel({
  requestRender: render,
  onRemovalComplete: refreshPrivateDataViews
})
const identityResolutionPanel = createIdentityResolutionPanel({
  requestRender: render,
  onIdentityResolutionChanged: () => Promise.all([viewingAnalysisPanel.refresh(), recommendationEnginePanel.refresh()])
})
const preferencePanel = createPreferencePanel({
  requestRender: render,
  onPreferenceChanged: () => refreshPrivateDataViews()
})
const tmdbCredentialPanel = createTmdbCredentialPanel({ requestRender: render })
const recommendationEnginePanel = createRecommendationEnginePanel({ requestRender: render })
const curatedAnchorResolutionPanel = createCuratedAnchorResolutionPanel({
  requestRender: render,
  onIdentityResolutionChanged: () => Promise.all([viewingAnalysisPanel.refresh(), recommendationEnginePanel.refresh(), identityResolutionPanel.refresh()])
})
const discoveredRecommendationsPanel = createDiscoveredRecommendationsPanel({ requestRender: render })
const recommendationHomePanel = createRecommendationHomePanel({ requestRender: render })

const shows = recommendationData.recommendations.map(recommendation => {
  const title = titlesById.get(recommendation.titleId)
  const score = recommendation.jointScore?.value
    ?? recommendation.viewerScores[0].score

  return {
    id: recommendation.titleId,
    title: title.title,
    service: 'Synthetic demo title',
    score,
    reason: recommendation.explanation,
    workflowStatus: recommendation.workflowStatus
  }
})

// Temporary browser-local interaction state for the public demo. This is not
// canonical viewing history or an append-only reaction record.
function loadDemoUiState() {
  try {
    const state = JSON.parse(
      localStorage.getItem(DEMO_UI_STATE_KEY) || '{}'
    )

    return state && typeof state === 'object' && !Array.isArray(state)
      ? state
      : {}
  } catch {
    return {}
  }
}

function saveDemoUiState(state) {
  localStorage.setItem(DEMO_UI_STATE_KEY, JSON.stringify(state))
}

function ensureDemoShowState(state, id, workflowStatus = 'unwatched') {
  if (!state[id]) {
    state[id] = {
      saved: workflowStatus === 'saved'
    }
  }

  return state[id]
}

function createPrivateId(prefix) {
  const value = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

  return `${prefix}_${value}`
}

async function ensurePrivateRecord(storeName, record) {
  const existing = await readPrivateRecord(storeName, record.id)

  if (!existing) {
    await createPrivateRecord(storeName, record)
  }
}

async function refreshPrivateDemoState() {
  const [events, reactions] = await Promise.all([
    listPrivateRecords(PRIVATE_STORES.historyEvents, {
      indexName: 'by-viewer',
      query: PRIVATE_DEMO_VIEWER_ID
    }),
    listPrivateRecords(PRIVATE_STORES.reactions, {
      indexName: 'by-viewer',
      query: PRIVATE_DEMO_VIEWER_ID
    })
  ])

  const reactionsByTitle = new Map()

  for (const reaction of reactions) {
    const current = reactionsByTitle.get(reaction.titleId)

    if (!current || reaction.recordedAt > current.recordedAt) {
      reactionsByTitle.set(reaction.titleId, reaction)
    }
  }

  privateDemoState = {
    status: 'ready',
    error: null,
    watchedTitleIds: new Set(
      events
        .filter(event => event.eventType === 'completed')
        .map(event => event.titleId)
    ),
    reactionsByTitle
  }
}

async function refreshPrivateDataViews() {
  await Promise.all([
    refreshPrivateDemoState(),
    viewingAnalysisPanel.refresh(),
    importBatchMaintenancePanel.refresh(),
    identityResolutionPanel.refresh(),
    preferencePanel.refresh(),
    recommendationEnginePanel.refresh(),
    tmdbCredentialPanel.refresh()
    ,recommendationHomePanel.refresh()
  ])
}

async function initializePrivateDemo() {
  try {
    await initializePrivateStore()
    await ensurePrivateRecord(PRIVATE_STORES.sources, {
      id: 'source:manual',
      schemaVersion: 1,
      name: 'Synthetic manual demo',
      kind: 'manual'
    })

    for (const viewer of [
      { id: 'viewer-1', displayName: 'Viewer 1' },
      { id: 'viewer-2', displayName: 'Viewer 2' }
    ]) {
      await ensurePrivateRecord(PRIVATE_STORES.viewers, {
        ...viewer,
        schemaVersion: 1,
        active: true
      })
    }

    await refreshPrivateDataViews()
  } catch (error) {
    privateDemoState = {
      ...privateDemoState,
      status: 'error',
      error
    }
  }

  render()
}

async function recordPrivateWatch(show) {
  if (privateDemoState.watchedTitleIds.has(show.id)) {
    return
  }

  await createHistoryEvent({
    id: createPrivateId('evt'),
    schemaVersion: 1,
    viewerIds: [PRIVATE_DEMO_VIEWER_ID],
    titleId: show.id,
    eventType: 'completed',
    mediaScope: { level: 'title' },
    occurredAt: new Date().toISOString(),
    observations: {
      sourceTitle: show.title,
      note: 'Synthetic in-app private-store test'
    },
    provenance: {
      sourceId: 'source:manual',
      importBatchId: null,
      sourceRecordId: 'private-demo-ui'
    }
  })

  await refreshPrivateDataViews()
}

async function recordPrivateReaction(show, reaction) {
  const current = privateDemoState.reactionsByTitle.get(show.id)

  if (current?.reaction === reaction) {
    return
  }

  const nextReaction = {
    id: createPrivateId('rct'),
    schemaVersion: 1,
    viewerId: PRIVATE_DEMO_VIEWER_ID,
    titleId: show.id,
    reaction,
    recordedAt: new Date().toISOString(),
    supersedesReactionId: current?.id ?? null,
    provenance: {
      sourceId: 'source:manual',
      sourceRecordId: 'private-demo-ui'
    }
  }

  if (current) {
    await supersedeReaction(nextReaction)
  } else {
    await createReaction(nextReaction)
  }

  await refreshPrivateDataViews()
}

async function updateShow(id, action) {
  const show = shows.find(item => item.id === id)

  if (!show) {
    return
  }

  try {
    if (action === 'watched') {
      await recordPrivateWatch(show)
    }

    if (action === 'liked' || action === 'disliked') {
      await recordPrivateReaction(show, action)
    }

    if (action === 'saved') {
      const state = loadDemoUiState()
      const showState = ensureDemoShowState(
        state,
        id,
        show.workflowStatus
      )

      showState.saved = !showState.saved
      saveDemoUiState(state)
    }

    render()
  } catch (error) {
    privateDemoState = {
      ...privateDemoState,
      status: 'error',
      error
    }

    render()
  }
}

function buttonClass(active) {
  return active ? 'action-button active' : 'action-button'
}

function createCard(show, state) {
  const showState = ensureDemoShowState(
    state,
    show.id,
    show.workflowStatus
  )
  const watched = privateDemoState.watchedTitleIds.has(show.id)
  const reaction = privateDemoState.reactionsByTitle.get(show.id)?.reaction
  const privateStoreUnavailable = privateDemoState.status !== 'ready'

  return `
    <article class="show-card">

      <div class="poster">
        <span>${show.title.charAt(0)}</span>
      </div>

      <div class="show-body">

        <div class="show-top">

          <div>
            <h2>${show.title}</h2>
            <p class="service">${show.service}</p>
          </div>

          <div class="match">
            <strong>${show.score}%</strong>
            <span>match</span>
          </div>

        </div>

        <div class="why-box">
          <span class="why-label">WHY IT FITS</span>
          <p>${show.reason}</p>
        </div>

        <div class="actions">

          <button
            class="${buttonClass(watched)}"
            data-id="${show.id}"
            data-action="watched"
            ${privateStoreUnavailable || watched ? 'disabled' : ''}
          >
            ${watched ? '✓ Watched' : 'Watched'}
          </button>

          <button
            class="${buttonClass(reaction === 'liked')}"
            data-id="${show.id}"
            data-action="liked"
            ${privateStoreUnavailable || reaction === 'liked' ? 'disabled' : ''}
          >
            ${reaction === 'liked' ? '✓ Liked' : 'Liked'}
          </button>

          <button
            class="${buttonClass(reaction === 'disliked')}"
            data-id="${show.id}"
            data-action="disliked"
            ${privateStoreUnavailable || reaction === 'disliked' ? 'disabled' : ''}
          >
            ${reaction === 'disliked'
              ? '✓ Not for us'
              : 'Not for us'}
          </button>

          <button
            class="${buttonClass(showState.saved)}"
            data-id="${show.id}"
            data-action="saved"
          >
            ${showState.saved ? '✓ Saved' : 'Save for later'}
          </button>

        </div>

      </div>
    </article>
  `
}

function getRecentlyWatched(state) {
  return shows.filter(show => privateDemoState.watchedTitleIds.has(show.id))
}

function createRecentItem(show) {
  const reaction = privateDemoState.reactionsByTitle.get(show.id)?.reaction
  const result = reaction
    ? `${reaction.charAt(0).toUpperCase()}${reaction.slice(1)}`
    : 'No explicit reaction yet'

  return `
    <div class="recent-item">
      <div>
        <strong>${show.title}</strong>
        <span>${result}</span>
      </div>

      <span>Recorded privately for Viewer 1</span>
    </div>
  `
}

function render() {
  const state = loadDemoUiState()
  const recentlyWatched = getRecentlyWatched(state)
  const privateDemoStatus = privateDemoState.status === 'loading'
    ? 'Private demo storage is loading.'
    : privateDemoState.status === 'error'
      ? 'Private demo storage is unavailable in this browser.'
      : `Private storage confirmed for Viewer 1: ${recentlyWatched.length} watched title${recentlyWatched.length === 1 ? '' : 's'} and ${privateDemoState.reactionsByTitle.size} reaction${privateDemoState.reactionsByTitle.size === 1 ? '' : 's'} reloaded from IndexedDB.`

  document.querySelector('#app').innerHTML = `
    <main class="app-shell">

      <header class="app-header">
        <div>
          <h1>TV Recommendations</h1>
          <p>What should we watch next?</p>
          <p>${privateDemoStatus}</p>
        </div>

        <div class="app-badge">
          Personal TV
        </div>
      </header>

      ${recommendationHomePanel.render(privateDemoState.status === 'ready')}

      <details class="workbench-section">
        <summary>Settings, data, and backup</summary>
        <p class="workbench-note">Use these when adding history or protecting your private local data.</p>
        ${netflixImportPanel.render(privateDemoState.status === 'ready')}
        ${amazonPrimeImportPanel.render(privateDemoState.status === 'ready')}
        ${privateBackupPanel.render(privateDemoState.status === 'ready')}
        ${viewingAnalysisPanel.render(privateDemoState.status === 'ready')}
        ${importBatchMaintenancePanel.render(privateDemoState.status === 'ready')}
      </details>

      <details class="workbench-section">
        <summary>Preferences, identity, and recommendation diagnostics</summary>
        <p class="workbench-note">Advanced private review tools. They are kept out of the routine discovery path.</p>
        ${identityResolutionPanel.render(privateDemoState.status === 'ready')}
        ${curatedAnchorResolutionPanel.render(privateDemoState.status === 'ready')}
        ${preferencePanel.render(privateDemoState.status === 'ready')}
        ${recommendationEnginePanel.render(privateDemoState.status === 'ready')}
        ${tmdbCredentialPanel.render(privateDemoState.status === 'ready')}
        ${discoveredRecommendationsPanel.render(privateDemoState.status === 'ready')}
      </details>

      <details class="workbench-section demo-workbench">
        <summary>Public demo and developer test controls</summary>
        <p class="workbench-note">Synthetic public-demo data only. It is not part of your private recommendation workflow.</p>
        <section class="section-heading">
          <h2>Public demo recommendations</h2>
          <p>Ranked by synthetic demo evidence.</p>
        </section>
        <section class="show-list">
          ${shows.map(show => createCard(show, state)).join('')}
        </section>
        <section class="recent-section">
          <div class="section-heading">
            <h2>Recently watched demo titles</h2>
            <p>Synthetic private history recorded for Viewer 1 in this browser.</p>
          </div>
          <div class="recent-list">
            ${recentlyWatched.length ? recentlyWatched.map(show => createRecentItem(show)).join('') : '<div class="empty-message">Nothing marked watched yet.</div>'}
          </div>
        </section>
      </details>

    </main>
  `

  document.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', async () => {
      await updateShow(
        button.dataset.id,
        button.dataset.action
      )
    })
  })

  netflixImportPanel.bind(privateDemoState.status === 'ready')
  amazonPrimeImportPanel.bind(privateDemoState.status === 'ready')
  privateBackupPanel.bind(privateDemoState.status === 'ready')
  viewingAnalysisPanel.bind(privateDemoState.status === 'ready')
  importBatchMaintenancePanel.bind(privateDemoState.status === 'ready')
  identityResolutionPanel.bind(privateDemoState.status === 'ready')
  curatedAnchorResolutionPanel.bind(privateDemoState.status === 'ready')
  preferencePanel.bind(privateDemoState.status === 'ready')
  recommendationEnginePanel.bind(privateDemoState.status === 'ready')
  discoveredRecommendationsPanel.bind(privateDemoState.status === 'ready')
  recommendationHomePanel.bind(privateDemoState.status === 'ready')
  tmdbCredentialPanel.bind(privateDemoState.status === 'ready')
}

render()
initializePrivateDemo()
