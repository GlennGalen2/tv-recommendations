# Public application data

`v1/` is a versioned, synthetic example of the normalized application data
model. Every data file must declare `dataClassification: "public-demo"` before
the integrity check will accept it. A future private data location can use the
same normalized model without becoming part of the public deployment.

Personal viewing history, reactions, preferences, comments, and raw service
exports must remain outside this repository and outside the deployed app. A raw
export may be normalized by a future local importer, but the export itself must
not be copied beneath `data/` or `public/`.

## Private browser-local data

`src/data/privateStore.js` defines the separate IndexedDB store used for real
user data. It contains no seeded records and is not a static data asset. The
private store keeps titles, viewers, source and import provenance, history,
append-only reactions, inferred evidence, and recommendations in distinct
object stores. Raw exports are not retained in import batches; those records
keep provenance such as source service, date, filename, and hash instead.

The module exposes small create, read, update, reaction-supersession, and
backup-export operations. Its backup export returns an in-memory structured
snapshot for a future user-directed backup or sync feature; it does not upload
anything. Database upgrades create stores idempotently and close stale browser
connections on version changes.

TMDb API Read Access Tokens are kept separately by
`src/data/tmdbCredentialStore.js`, in a distinct browser-local IndexedDB
database. They are never part of `privateStore` records, backup exports,
diagnostics, or public assets. A token must be configured independently on
each browser/device and is intentionally not synchronized or backed up.

## Derived viewing analysis

The private Viewing History Analysis is recomputed locally from immutable
playback events and private title/source records. It is deliberately not
persisted: recomputation is inexpensive at the current scale and prevents a
derived summary becoming a competing authority or going stale after an import,
restore, or future correction. It does not infer preferences or reactions.

Cross-source title consolidation is automatic only for exactly normalized
display titles with the same known type (`movie` or `series`). Unknown source
titles remain separate, reversible references. Future metadata enrichment may
add authoritative external IDs (for example TMDb, IMDb, TVDB, or provider
catalog IDs), release year, media type, season/episode numbers, and original
language to resolve those references safely.

## Private metadata enrichment and identity resolution

`identityResolutions` is a private, append-only IndexedDB store separate from
playback events and source-title records. A resolution references a `sourceTitleId`
and records one of `unresolved`, `candidate-match`, `confidently-resolved`,
`manually-confirmed`, or `manually-rejected`, plus provider, provider ID, media
type, canonical title, optional release/series/season/episode details,
confidence, method, timestamp, rationale, and `supersedesResolutionId` when it
corrects an earlier decision. This leaves imported events immutable and makes
every correction reversible by appending an explicit `unresolved` undo record.

Provider adapters will later turn a source-title record and its known episode
structure into a provider-independent query and candidate list. Until a
provider is deliberately connected, the UI uses a clearly labelled synthetic
candidate only; it neither looks up nor resolves imported titles.

For a private, non-commercial app, TMDb is the recommended first adapter: it
has both movie and TV coverage and stable IDs; its non-commercial API is free
with required attribution. TMDb says to respect `429` responses and describes
an approximate upper limit near 40 requests/second. TVmaze is a useful
TV-only supplement with strong episode/season endpoints, but it does not cover
movies and documents at least 20 calls per 10 seconds per IP. OMDb can search
movies, series, and episodes through an IMDb-ID-oriented API, but has a more
limited metadata model and requires an API key; the official IMDb API itself
uses AWS Data Exchange credentials and subscription approval. Any future
browser-only adapter must treat an API key as exposed to the browser; a key
must be personally scoped and rate-limited, or a future private backend would
be needed. No provider key or network integration exists today.

Proposed automation policy (not enabled): automatically accept only a score of
at least `0.995` when normalized title, known type, and a second independent
identifier agree (release year or fully matching series/season/episode
structure), with no competing candidate. Scores from `0.85` through `0.994`
remain review-required; lower scores stay unresolved. Title-text similarity by
itself never crosses either threshold.

## Authority and evidence flow

1. `catalog/` supplies stable canonical title identities.
2. `provenance/` identifies normalized sources and import batches. Raw exports
   are never stored here.
3. `history/` records observations. It is authoritative for whether something
   was watched and does not express conclusions about taste.
4. `reactions/` records explicit viewer statements. Records are append-only;
   changes point to the earlier record with `supersedesReactionId`.
5. `preferences/` stores inferred evidence separately and cites the history,
   reaction, or earlier evidence records on which an inference is based.
6. `recommendations/` stores durable, inspectable outputs. These may cite
   inferred evidence but are not authoritative preference records.

Recommendation `workflowStatus` is limited to `unwatched`, `saved`, or
`dismissed`. A displayed `watched` state must be derived from history rather
than persisted as a competing authority. The current interactive controls use
a separately named, browser-local demo state; it is temporary UI behavior and
is not canonical history or an append-only reaction store.

Group recommendations preserve a score for every viewer plus a separate joint
score. The joint method must expose a disagreement penalty and cannot identify
itself as a simple average. The precise formula remains intentionally open.

## IDs and evolution

Records use stable IDs rather than array positions. A canonical title ID is
immutable once assigned. Correcting its display title or release-year metadata
must not change that ID.

Every top-level data file has `schemaVersion: 1`. New optional fields should be
additive. A migration is needed only when an existing field changes meaning or
structure.

Files under `v1/schemas/` are formal JSON Schema contracts and documentation.
They are not currently executed by `npm run validate:data`. That command runs
dependency-free file-classification and cross-file integrity checks instead.
