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
