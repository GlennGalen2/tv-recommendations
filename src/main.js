import './style.css'

const shows = [
  {
    id: 'night-manager',
    title: 'The Night Manager',
    score: 94,
    genre: 'Espionage / Thriller',
    service: 'Check service',
    description:
      'Serious international espionage with capable characters, moral stakes, strong performances, and relatively grounded tradecraft.'
  },
  {
    id: 'unforgotten',
    title: 'Unforgotten',
    score: 93,
    genre: 'Mystery / Crime',
    service: 'Check service',
    description:
      'Patient British investigations built around character, accumulated evidence, and the consequences of long-buried crimes.'
  },
  {
    id: 'tehran',
    title: 'Tehran',
    score: 89,
    genre: 'Espionage / Drama',
    service: 'Check service',
    description:
      'Intelligence operations, conflicting loyalties, suspense, and complicated people operating under intense pressure.'
  },
  {
    id: 'babylon-berlin',
    title: 'Babylon Berlin',
    score: 87,
    genre: 'Historical / Mystery',
    service: 'Check service',
    description:
      'An ambitious historical mystery with political intrigue, evolving information, atmosphere, and a richly constructed world.'
  }
]

function getRatings() {
  return JSON.parse(localStorage.getItem('tv-ratings') || '{}')
}

function saveRatings(ratings) {
  localStorage.setItem('tv-ratings', JSON.stringify(ratings))
}

function setRating(showId, person, value) {
  const ratings = getRatings()

  if (!ratings[showId]) {
    ratings[showId] = {}
  }

  ratings[showId][person] = value
  saveRatings(ratings)
  render()
}

function ratingButton(showId, person, value, label, currentValue) {
  const selected = currentValue === value ? 'selected' : ''

  return `
    <button
      class="rating-button ${selected}"
      data-show="${showId}"
      data-person="${person}"
      data-value="${value}"
    >
      ${label}
    </button>
  `
}

function createCard(show, ratings) {
  const showRatings = ratings[show.id] || {}

  return `
    <article class="show-card">

      <div class="poster">
        <span>${show.title.charAt(0)}</span>
      </div>

      <div class="show-content">

        <div class="show-heading">
          <div>
            <h2>${show.title}</h2>
            <p class="genre">${show.genre}</p>
          </div>

          <div class="score">
            <strong>${show.score}%</strong>
            <span>match</span>
          </div>
        </div>

        <p class="description">
          ${show.description}
        </p>

        <p class="service">
          Streaming: <strong>${show.service}</strong>
        </p>

        <div class="rating-section">
          <h3>Glenn</h3>

          <div class="rating-row">
            ${ratingButton(show.id, 'glenn', 'watched', 'Watched', showRatings.glenn)}
            ${ratingButton(show.id, 'glenn', 'liked', 'Liked', showRatings.glenn)}
            ${ratingButton(show.id, 'glenn', 'disliked', 'Not for me', showRatings.glenn)}
          </div>
        </div>

        <div class="rating-section">
          <h3>Wife</h3>

          <div class="rating-row">
            ${ratingButton(show.id, 'wife', 'watched', 'Watched', showRatings.wife)}
            ${ratingButton(show.id, 'wife', 'liked', 'Liked', showRatings.wife)}
            ${ratingButton(show.id, 'wife', 'disliked', 'Not for me', showRatings.wife)}
          </div>
        </div>

      </div>
    </article>
  `
}

function render() {
  const ratings = getRatings()

  document.querySelector('#app').innerHTML = `
    <main class="app-shell">

      <header class="top-header">
        <div>
          <h1>TV Recommendations</h1>
          <p>Personal recommendations for Glenn & wife</p>
        </div>

        <div class="prototype-label">
          PWA prototype
        </div>
      </header>

      <section class="recommendation-header">
        <h2>Recommended for you</h2>
        <p>
          Ranked from what we currently know about your viewing preferences.
        </p>
      </section>

      <section class="show-list">
        ${shows.map(show => createCard(show, ratings)).join('')}
      </section>

    </main>
  `

  document.querySelectorAll('.rating-button').forEach(button => {
    button.addEventListener('click', () => {
      setRating(
        button.dataset.show,
        button.dataset.person,
        button.dataset.value
      )
    })
  })
}

render()