import './style.css'

const shows = [
  {
    id: 'night-manager',
    title: 'The Night Manager',
    service: 'Prime / AMC+',
    score: 94,
    reason:
      'Strong espionage atmosphere, capable adults, moral stakes, and serious dialogue. Less exaggerated than many spy thrillers.'
  },
  {
    id: 'unforgotten',
    title: 'Unforgotten',
    service: 'PBS / Prime',
    score: 93,
    reason:
      'Patient mystery construction, accumulated evidence, strong character work, and emotionally credible consequences.'
  },
  {
    id: 'tehran',
    title: 'Tehran',
    service: 'Apple TV+',
    score: 89,
    reason:
      'Espionage, divided loyalties, evolving information, and competent characters under pressure.'
  },
  {
    id: 'babylon-berlin',
    title: 'Babylon Berlin',
    service: 'Check availability',
    score: 87,
    reason:
      'Complex historical mystery, political intrigue, strong atmosphere, and an unusually rich fictional world.'
  }
]

function loadState() {
  return JSON.parse(localStorage.getItem('tv-app-state') || '{}')
}

function saveState(state) {
  localStorage.setItem('tv-app-state', JSON.stringify(state))
}

function ensureShowState(state, id) {
  if (!state[id]) {
    state[id] = {
      watched: false,
      rating: null,
      saved: false
    }
  }

  return state[id]
}

function updateShow(id, action) {
  const state = loadState()
  const showState = ensureShowState(state, id)

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

  saveState(state)
  render()
}

function buttonClass(active) {
  return active ? 'action-button active' : 'action-button'
}

function createCard(show, state) {
  const showState = ensureShowState(state, show.id)

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
  const showState = ensureShowState(state, show.id)

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
  const state = loadState()
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
        <p>Ranked by predicted fit.</p>
      </section>

      <section class="show-list">
        ${shows.map(show => createCard(show, state)).join('')}
      </section>

      <section class="recent-section">

        <div class="section-heading">
          <h2>Recently watched</h2>
          <p>Anything you mark Watched appears here.</p>
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