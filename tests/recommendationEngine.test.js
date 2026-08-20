import assert from 'node:assert/strict'
import { deriveRecommendations, jointScore, learnMechanismWeights, REACTION_WEIGHTS, scoreRecommendationCandidate } from '../src/data/recommendationEngine.js'

const titles = [
  { id: 'title:loved', title: 'Synthetic Loved Anchor', type: 'series', mechanisms: { positive: ['mystery-conspiracy'], negative: [] } },
  { id: 'title:disliked', title: 'Synthetic Disliked Anchor', type: 'series', mechanisms: { positive: [], negative: ['fourth-wall-device'] } },
  { id: 'title:mechanism-fit', title: 'Synthetic Mystery Candidate', type: 'series', metadata: { mechanisms: { positive: ['mystery-conspiracy'], negative: [] } } },
  { id: 'title:mechanism-negative', title: 'Synthetic Device Candidate', type: 'series', metadata: { mechanisms: { positive: ['fourth-wall-device'], negative: [] } } },
  { id: 'title:neutral', title: 'Synthetic Neutral Candidate', type: 'movie' },
  { id: 'title:repeat', title: 'Synthetic Repeat Anchor', type: 'series' }
]
const reactions = [
  { id: 'r-loved', viewerId: 'viewer-1', titleId: 'title:loved', reaction: 'loved', strength: 1, mechanisms: { positive: ['mystery-conspiracy'], negative: [] }, supersedesReactionId: null },
  { id: 'r-disliked', viewerId: 'viewer-1', titleId: 'title:disliked', reaction: 'disliked', strength: 1, mechanisms: { positive: [], negative: ['fourth-wall-device'] }, supersedesReactionId: null },
  { id: 'r-v2-loved', viewerId: 'viewer-2', titleId: 'title:mechanism-fit', reaction: 'loved', strength: 1, mechanisms: { positive: ['mystery-conspiracy'], negative: [] }, supersedesReactionId: null },
  { id: 'r-v2-disliked', viewerId: 'viewer-2', titleId: 'title:mechanism-negative', reaction: 'disliked', strength: 1, mechanisms: { positive: [], negative: ['fourth-wall-device'] }, supersedesReactionId: null }
]
const events = [
  { id: 'repeat-1', eventType: 'playback', viewerIds: ['viewer-1'], titleId: 'title:repeat', mediaScope: { level: 'episode', seasonNumber: 1, episodeNumber: 1 } },
  { id: 'repeat-2', eventType: 'playback', viewerIds: ['viewer-1'], titleId: 'title:repeat', mediaScope: { level: 'episode', seasonNumber: 1, episodeNumber: 1 } }
]
const behavioralEvidence = [
  { id: 'behavior-complete', viewerId: 'viewer-1', titleId: 'title:disliked', signal: 'completed_available_run', confidence: 1 },
  { id: 'behavior-repeat', viewerId: 'viewer-1', titleId: 'title:repeat', signal: 'repeat_viewing', confidence: 0.75 },
  { id: 'behavior-uncertain', viewerId: 'viewer-1', titleId: 'title:neutral', signal: 'availability_uncertain', confidence: 0.25 }
]
const scored = deriveRecommendations({ titles, reactions, events, behavioralEvidence })
const direct = (titleId, viewerId, otherViewerId) => scoreRecommendationCandidate({ title: titles.find(title => title.id === titleId), viewerId, otherViewerId, titles, reactions, events, behavioralEvidence })
const v1 = id => direct(id, 'viewer-1', 'viewer-2')
const v2 = id => direct(id, 'viewer-2', 'viewer-1')

assert.equal(REACTION_WEIGHTS.loved > REACTION_WEIGHTS.liked, true)
assert.equal(v1('title:loved').score > v1('title:repeat').score, true)
assert.equal(v1('title:disliked').score < 50, true)
assert.equal(v1('title:repeat').score > v1('title:neutral').score, true)
assert.equal(v1('title:mechanism-fit').score > v1('title:mechanism-negative').score, true)
assert.equal(v1('title:neutral').score, 50)
assert.equal(v2('title:mechanism-fit').score > v1('title:mechanism-fit').score, true)
const disagreement = jointScore({ score: 95 }, { score: 10 })
assert.equal(disagreement.value < 45, true)
assert.equal(v1('title:mechanism-fit').reasons.join(' ').includes('mystery conspiracy'), true)
assert.equal(v1('title:disliked').reasons.join(' ').includes('does not override'), true)
assert.equal(scored.viewerOne.some(item => item.titleId === 'title:loved'), false)
assert.equal(scored.viewerOne.some(item => item.titleId === 'title:repeat'), false)
assert.equal(scored.explicitAnchorExclusions['viewer-1'], 2)
assert.equal(JSON.stringify(scored).includes('r-loved'), false)
assert.equal(events.length, 2)
assert.equal(reactions.length, 4)

const sharedBaselineReactions = [
  { id: 'shared-v1-positive', viewerId: 'viewer-1', titleId: 'shared-positive', reaction: 'loved', strength: 1, mechanisms: { positive: ['credible-professional-behavior'], negative: [] } },
  { id: 'shared-v1-negative', viewerId: 'viewer-1', titleId: 'shared-negative', reaction: 'disliked', strength: 1, mechanisms: { positive: [], negative: ['criminal-protagonist'] } },
  { id: 'specific-v2-override', viewerId: 'viewer-2', titleId: 'specific-v2', reaction: 'disliked', strength: 1, mechanisms: { positive: [], negative: ['credible-professional-behavior'] } }
]
const fallbackWeights = learnMechanismWeights(sharedBaselineReactions, 'viewer-2')
assert.equal(fallbackWeights.get('criminal-protagonist') < 0, true)
assert.equal(fallbackWeights.get('credible-professional-behavior') < 0, true)
const sharedRiskCandidate = { id: 'shared-risk-candidate', title: 'Synthetic Shared Risk', type: 'series', externalIds: { tmdb: 'shared-risk' } }
const sharedRiskEvidence = [{ id: 'shared-risk-evidence', target: { provider: 'tmdb', mediaType: 'tv', externalId: 'shared-risk' }, attributes: [{ attribute: 'criminal-protagonist-risk', direction: 'present', value: 1, confidence: 1, mechanisms: ['criminal-protagonist'], source: 'synthetic-human-curation', rationale: 'Synthetic shared moral-risk evidence.' }] }]
const fallbackScore = scoreRecommendationCandidate({ title: sharedRiskCandidate, viewerId: 'viewer-2', otherViewerId: 'viewer-1', reactions: sharedBaselineReactions, candidateEvidence: sharedRiskEvidence })
assert.equal(fallbackScore.score < 50, true)

console.log('Recommendation engine checks passed.')
