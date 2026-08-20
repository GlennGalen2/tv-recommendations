const REQUIRED_PACKET_FIELDS = ['title', 'year', 'mediaType', 'synopsis', 'criticalObservations', 'protagonistMoralSetup', 'violenceBrutalityNotes', 'dialogueToneNotes', 'professionalRealismNotes', 'storytellingMysteryNotes', 'sources', 'uncertainties']

export const RESEARCH_PACKET_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: REQUIRED_PACKET_FIELDS,
  properties: {
    title: { type: 'string', minLength: 1 },
    year: { type: ['integer', 'null'], minimum: 1888 },
    mediaType: { type: 'string', enum: ['movie', 'tv'] },
    synopsis: { type: 'string', minLength: 1 },
    criticalObservations: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    protagonistMoralSetup: { type: 'string', minLength: 1 },
    violenceBrutalityNotes: { type: 'string', minLength: 1 },
    dialogueToneNotes: { type: 'string', minLength: 1 },
    professionalRealismNotes: { type: 'string', minLength: 1 },
    storytellingMysteryNotes: { type: 'string', minLength: 1 },
    sources: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['provider', 'reference', 'url'], properties: { provider: { type: 'string', minLength: 1 }, reference: { type: 'string', minLength: 1 }, url: { type: 'string', minLength: 1 } } } },
    uncertainties: { type: 'array', items: { type: 'string' }, maxItems: 6 }
  }
})

function requireText(value, field) { if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Research target ${field} is required.`) }
function packetError(message, type) { const error = new TypeError(message); error.type = type; return error }

export function validateResearchTarget(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw new TypeError('A research target is required.')
  requireText(target.title, 'title')
  if (!['movie', 'tv'].includes(target.mediaType)) throw new TypeError('Research target mediaType must be movie or tv.')
  if (target.year !== undefined && target.year !== null && (!Number.isInteger(target.year) || target.year < 1888)) throw new TypeError('Research target year must be an integer when supplied.')
  return target
}

export function buildResearchPrompt(target) {
  validateResearchTarget(target)
  return `Research the ${target.mediaType === 'tv' ? 'TV series' : 'film'} ${target.title}${target.year ? ` (${target.year})` : ''} using web search. Produce a compact factual research packet for a later private recommendation evaluator. The output identity fields are bookkeeping, not a request to reinterpret identity: copy title exactly as ${JSON.stringify(target.title)}, mediaType exactly as ${JSON.stringify(target.mediaType)}, and year exactly as ${JSON.stringify(target.year ?? null)}. Search for independent professional reviews and substantive criticism, not fan discussion. Do not copy long review passages. Do not claim a trait unless the source material supports it; write "unknown from reviewed sources" where appropriate. Distinguish depiction from endorsement: criminality is relevant only when sources support the protagonist's motives, harm, accountability, or the work's moral framing. Cover tone, dialogue, professional realism, violence/torture/gore, narrative structure, and meaningful uncertainty. Cite 2 through 6 sources with publisher, page title/reference, and URL. Return JSON only, exactly matching the supplied schema.`
}

function comparableTitle(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

export function validateResearchPacketOutput(packet, target) {
  validateResearchTarget(target)
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw packetError('Research output must be an object.', 'research_packet_invalid_shape')
  for (const field of REQUIRED_PACKET_FIELDS) if (!(field in packet)) throw packetError(`Research output ${field} is required.`, 'research_packet_missing_field')
  if (comparableTitle(packet.title) !== comparableTitle(target.title) || packet.mediaType !== target.mediaType || (target.year && packet.year !== target.year)) throw packetError('Research output does not match its requested target.', 'research_target_mismatch')
  if (!Array.isArray(packet.sources) || packet.sources.length < 2 || packet.sources.some(source => !source || typeof source.provider !== 'string' || typeof source.reference !== 'string' || typeof source.url !== 'string')) throw packetError('Research output requires two or more cited sources.', 'research_insufficient_sources')
  return { ...packet, title: target.title, mediaType: target.mediaType, year: target.year ?? packet.year }
}

export async function researchCandidate({ adapter, target }) {
  if (!adapter || typeof adapter.research !== 'function') throw new TypeError('A web research provider adapter is required.')
  const startedAt = performance.now()
  const response = await adapter.research({ prompt: buildResearchPrompt(target), outputSchema: RESEARCH_PACKET_SCHEMA })
  let packet
  try { packet = validateResearchPacketOutput(JSON.parse(response.text), target) }
  catch (cause) { const error = new Error(cause?.message || 'Web research returned an invalid packet.'); error.type = cause?.type || 'research_packet_validation_failed'; throw error }
  return { packet, latencyMs: Math.round(performance.now() - startedAt), usage: response.usage || null, costUsd: Number.isFinite(response.costUsd) ? response.costUsd : null }
}
