import './style.css'
import catalog from '../data/v1/catalog/titles.json'
import recommendationData from '../data/v1/recommendations/recommendations.json'

const titlesById = new Map(
  catalog.titles.map(title => [title.id, title])
)

const DEMO_UI_STATE_KEY = 'tv-app-demo-ui-state-v1'

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
      watched: false,
      rating: null,
      saved: workflowStatus === 'saved'
    }
  }

  return state[id]
}

function updateShow(id, action) {
  const state = loadDemoUiState()
  const showState = ensureDemoShowState(state, id)

  if (action === 'watched') {
    showState.watched = !showState.watched
  }

  if (action === 'liked') {
    showState.rating =
      showState.rating === 'liked' ? null : 'liked'
  }

  if (action === 'disliked') {
    showState.rating =
      showState.rating === 'disliked' ? null : 'disliked'
  }

  if (action === 'saved') {
    showState.saved = !showState.saved
  }

  saveDemoUiState(state)
  render()
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
            class="${buttonClass(showState.watched)}"
            data-id="${show.id}"
            data-action="watched"
          >
            ${showState.watched ? '✓ Watched' : 'Watched'}
          </button>

          <button
            class="${buttonClass(showState.rating === 'liked')}"
            data-id="${show.id}"
            data-action="liked"
          >
            ${showState.rating === 'liked' ? '✓ Liked' : 'Liked'}
          </button>

          <button
            class="${buttonClass(showState.rating === 'disliked')}"
            data-id="${show.id}"
            data-action="disliked"
          >
            ${showState.rating === 'disliked'
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
  return shows.filter(show => state[show.id]?.watched)
}

function createRecentItem(show, state) {
  const showState = ensureDemoShowState(state, show.id)

  let result = 'Not rated yet'

  if (showState.rating === 'liked') {
    result = 'Liked'
  }

  if (showState.rating === 'disliked') {
    result = 'Not for us'
  }

  return `
    <div class="recent-item">
      <div>
        <strong>${show.title}</strong>
        <span>${result}</span>
      </div>

      <button
        class="small-button"
        data-id="${show.id}"
        data-action="watched"
      >
        Undo watched
      </button>
    </div>
  `
}

function render() {
  const state = loadDemoUiState()
  const recentlyWatched = getRecentlyWatched(state)

  document.querySelector('#app').innerHTML = `
    <main class="app-shell">

      <header class="app-header">
        <div>
          <h1>TV Recommendations</h1>
          <p>What should we watch next?</p>
        </div>

        <div class="app-badge">
          Personal TV
        </div>
      </header>

      <section class="section-heading">
        <h2>Recommended for us</h2>
        <p>Ranked by synthetic demo evidence.</p>
      </section>

      <section class="show-list">
        ${shows.map(show => createCard(show, state)).join('')}
      </section>

      <section class="recent-section">

        <div class="section-heading">
          <h2>Recently watched</h2>
          <p>Demo-only selections stored in this browser; not canonical history.</p>
        </div>

        <div class="recent-list">
          ${
            recentlyWatched.length
              ? recentlyWatched
                  .map(show => createRecentItem(show, state))
                  .join('')
              : `
                <div class="empty-message">
                  Nothing marked watched yet.
                </div>
              `
          }
        </div>

      </section>

    </main>
  `

  document.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', () => {
      updateShow(
        button.dataset.id,
        button.dataset.action
      )
    })
  })
}

render()
