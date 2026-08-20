# TV Recommendations Project --- Architecture, Intent, and Operating Guide

## Purpose

This file is the durable project brief for Codex and any future AI
working on this repository.

The project is not primarily a conventional recommendation algorithm.
Its purpose is to build a private personal television and film
recommendation system for two viewers that learns *why* they like or
dislike works and uses those mechanisms when evaluating unfamiliar
candidates.

The desired workflow is:

1.  The human owners supply viewing history, explicit reactions,
    corrections, and occasional qualitative feedback.
2.  Deterministic code maintains identity, provenance, privacy,
    eligibility, evidence, and reproducible bookkeeping.
3.  TMDb supplies canonical identity, metadata, and candidate discovery.
4.  A capable LLM performs qualitative interpretation that databases and
    numerical similarity cannot do well.
5.  The LLM reads a detailed private viewer-preference profile plus
    researched evidence about each candidate.
6.  Deterministic code validates, records, compares, and explains the
    LLM output.
7.  The system learns from subsequent explicit reactions without
    silently rewriting historical evidence.

The architecture should remain simple enough for one owner to operate
but rigorous enough that future agents can extend it safely.

------------------------------------------------------------------------

## Who Makes Which Decisions

### Human owner

The owner is the authority on actual taste and on whether a
recommendation was good.

Do not require the owner to become the programmer or systems integrator.
Avoid workflows based on repeated manual code editing or copying
snippets among source files.

The owner should normally be asked only to:

-   provide or import private data;
-   resolve genuinely ambiguous title identities;
-   rate works or correct reactions;
-   review recommendation quality;
-   provide credentials locally when required;
-   approve significant architectural or privacy changes.

### ChatGPT / architectural AI

The architectural AI is expected to reason about the system as a whole:

-   choose and revise architecture;
-   identify weaknesses in the recommendation methodology;
-   translate human taste observations into durable design principles;
-   design experiments and benchmarks;
-   decide what should be deterministic versus LLM-based;
-   give Codex implementation objectives and acceptance criteria.

Architecture is not sacred. If evidence shows that a design assumption
is wrong, improve it.

### Codex

Codex is an implementation and engineering partner, not merely a command
executor.

Codex should:

-   inspect the existing repository before changing it;
-   reason about how a requested capability fits the architecture;
-   identify contradictions, bugs, privacy risks, and missing tests;
-   propose a better implementation when the requested implementation
    would be fragile;
-   implement, test, validate, and report;
-   preserve private/public boundaries;
-   explain substantive architectural concerns rather than blindly
    following an obsolete instruction.

Codex is encouraged to work out engineering problems with the owner and
architectural AI.

------------------------------------------------------------------------

## Core Recommendation Philosophy

### Preference mechanisms matter more than genre labels

Genre similarity is weak evidence.

The system should learn mechanisms such as:

-   rootable, capable characters;
-   fundamentally decent motives;
-   moral identification with central characters;
-   credible professional behavior;
-   intelligent plotting;
-   accumulating/evolving information;
-   competing agendas;
-   sophisticated adult dialogue;
-   subtext, implication, pauses, and non-expository speech;
-   coherent speculative rules;
-   patient plotting;
-   character relationships;
-   historical atmosphere;
-   excessive brutality or torture;
-   unrootable protagonists;
-   selfish criminality that harms others;
-   caricature;
-   implausible workplace behavior;
-   fourth-wall devices;
-   expository plot-recapping dialogue.

This vocabulary is extensible. Do not turn it into a brittle closed
ontology.

### Premise alone is not destiny

A viewer can dislike a premise yet love the finished show because
character execution, dialogue, relationships, mystery, or information
structure overcome the initial resistance.

Silo is an important example of this principle.

Therefore candidate evaluation must not over-penalize genre or premise
when the execution mechanisms strongly fit.

### Quality and personal fit are different

A show can be excellent and still be a poor recommendation for a
particular viewer.

The Americans is an important example: high-quality espionage drama can
still create substantial Viewer 1 risk because of moral identification
and unusually uncomfortable suspense.

The evaluator should distinguish:

-   artistic/technical quality;
-   likely personal enjoyment;
-   specific risk mechanisms.

### Moral identification is nuanced

Do not use a crude rule such as "crime is bad."

The important question is whether the viewer can root for the central
character.

A protagonist who breaks laws for selfish, lawless purposes while
harming innocent people is a serious negative for Viewer 1, particularly
when the narrative asks the audience to identify with that person
without meaningful moral consequence.

Context, motive, remorse, consequences, and narrative stance matter.

### Missing evidence is uncertainty, not a negative

Never infer dislike from absence of viewing.

Never infer a qualitative trait merely because a database lacks
information.

Confidence should represent the strength and completeness of evidence,
not positivity.

Strong negative evidence can lower fit while raising confidence.

------------------------------------------------------------------------

## Two Viewers Must Remain Distinct

Viewer 1 and Viewer 2 are separate preference models.

Do not average them into a fictional single person.

A joint recommendation should normally favor the lower individual fit
and penalize disagreement, because a shared viewing choice is poor if
one viewer is likely to dislike it.

Known differences must remain visible. Virgin River is an important
example: Viewer 2 loves it while Viewer 1 considers it only okay.

Where Viewer 2 evidence is sparse, preserve uncertainty instead of
copying Viewer 1's preferences.

------------------------------------------------------------------------

## Evidence Hierarchy

### Explicit reactions

Explicit human reactions are the strongest preference evidence.

They should be durable, private, append-only records. Corrections should
supersede prior reactions rather than destructively rewriting history.

Explicit evidence overrides contradictory behavioral inference for
interpretation, while the underlying behavioral evidence remains
preserved.

### Behavioral viewing evidence

Viewing history can provide weaker evidence.

Useful signals include:

-   completed available run;
-   near-complete run;
-   substantial viewing;
-   repeat viewing;
-   early abandonment only when continued availability is known.

Availability uncertainty must never be converted into dislike.

If a viewer watched an entire available run, that is meaningful positive
evidence even without an explicit rating.

### Curated qualitative mechanisms

Human-curated mechanisms and later LLM-derived candidate attributes can
enrich scoring.

All such evidence needs provenance, confidence, and a rationale.

Do not silently invent traits.

------------------------------------------------------------------------

## New-Recommendation Eligibility

A title is not a new recommendation for a viewer if that viewer:

-   has a current explicit reaction to it; or
-   is known from private history to have watched it.

A curated explicit-preference title absent from playback history is
still known/rated and therefore excluded.

For joint new recommendations, normally exclude a title if either viewer
has watched or explicitly rated it.

Rated/watched titles remain fully usable as training anchors.

Do not manufacture candidates merely to fill a list.

A separate rewatch mode may be designed later; do not mix it into
new-title recommendations.

------------------------------------------------------------------------

## TMDb's Role

TMDb is useful for:

-   canonical title identity;
-   media type/year disambiguation;
-   metadata;
-   recommendation/similar endpoints;
-   bounded candidate discovery.

TMDb is **not** sufficient to determine personal qualitative fit.

Its recommendation graph can produce superficially related works that
violate important human preferences.

Therefore TMDb discovery should create a candidate pool, not the final
recommendation judgment.

Confirmed identities should be used conservatively. Ambiguous identities
should be reviewed rather than guessed.

------------------------------------------------------------------------

## Why an LLM Is Required

Many decisive attributes are not available as reliable structured
database fields:

-   whether dialogue feels adult and natural;
-   whether characters communicate through subtext;
-   whether workplace behavior is credible;
-   whether protagonists are morally rootable;
-   whether criminality is selfish or morally contextualized;
-   whether violence is excessive relative to the story;
-   whether a mystery reveals information fairly;
-   whether characters behave intelligently;
-   whether a show is serious, caricatured, sentimental, expository, or
    psychologically believable.

These require interpretation of prose evidence.

The intended evaluator therefore uses an LLM as a qualitative reader and
critic, not as a replacement for deterministic bookkeeping.

------------------------------------------------------------------------

## LLM Candidate Evaluation Architecture

For each candidate, the LLM should receive:

1.  the complete private viewer-preference profile;
2.  a candidate research packet;
3.  a strict output contract.

The research packet may contain:

-   synopsis;
-   review excerpts or paraphrased critical observations;
-   protagonist moral setup;
-   violence/brutality notes;
-   dialogue/tone notes;
-   professional-realism notes;
-   storytelling/mystery notes;
-   source provenance.

The LLM should return separate Viewer 1, Viewer 2, and joint evaluations
with:

-   fit score;
-   confidence;
-   canonical positive mechanism tags;
-   canonical negative/risk tags;
-   natural-language positive factors;
-   natural-language red flags;
-   concise rationale.

Canonical tags exist for machine comparison. Natural-language
explanation exists for human interpretation.

Do not force uncertain evidence into a canonical tag.

The LLM output is evidence/prediction, not ground truth.

------------------------------------------------------------------------

## LLM Model Strategy

Use the cheapest model that passes meaningful benchmarks.

Current benchmark work is testing GPT-5.4 Nano as a low-cost baseline
because this task is primarily qualitative classification/ranking rather
than theorem proving.

Do not assume a larger model is necessary.

Benchmark inexpensive models against known reactions and difficult
nuance cases. Escalate to a stronger model only when the cheaper model
makes consequential errors.

Model/provider access should remain replaceable behind a
provider-neutral adapter.

------------------------------------------------------------------------

## Benchmarking Principles

A benchmark must contain genuine known outcomes, not predictions
disguised as ground truth.

Good benchmark cases include works for which the viewers' reactions are
already known and which test different mechanisms.

Important benchmark dimensions include:

-   very strong positive anchors;
-   viewer disagreement;
-   liked-despite-reservations cases;
-   moral-identification negatives;
-   fourth-wall negatives;
-   premise-versus-execution nuance;
-   high-quality-but-personally-risky works;
-   uncertainty where one viewer has little evidence.

Evaluate:

-   score-range accuracy;
-   positive-mechanism recall;
-   red-flag recall;
-   major qualitative misses;
-   invalid structured outputs;
-   latency;
-   token usage;
-   cost;
-   repeat consistency when needed.

Canonical tags should be used for automated recall metrics. Do not score
semantic prose using exact string equality.

------------------------------------------------------------------------

## Research Layer

TMDb metadata alone is insufficient.

For serious candidate evaluation, assemble a bounded research packet
from credible descriptions, reviews, interviews, recaps, or other
appropriate sources.

The research stage should seek evidence relevant to the viewer profile
rather than merely collecting generic reviews.

Examples:

-   What do critics say about dialogue?
-   Are central characters sympathetic/rootable?
-   Is the protagonist's criminal behavior selfish or morally
    contextualized?
-   Is professional procedure credible?
-   Is violence/torture prominent?
-   Does the plot rely on arbitrary late facts?
-   Does information accumulate in a satisfying way?
-   Is the tone serious or caricatured?

Do not require exhaustive internet research for every low-probability
candidate. Use staged filtering:

TMDb discovery → cheap preliminary filtering → targeted research → LLM
fit evaluation → ranked shortlist.

The exact staging can evolve based on measured cost and quality.

------------------------------------------------------------------------

## Deterministic Engine vs LLM

Keep deterministic code for things that computers can know exactly:

-   identity;
-   deduplication;
-   watched/rated exclusion;
-   provenance;
-   supersession;
-   data validation;
-   privacy boundaries;
-   candidate aggregation;
-   confidence bookkeeping;
-   benchmark measurement;
-   caching;
-   API failure handling.

Use the LLM for things requiring interpretation:

-   character rootability;
-   moral stance;
-   dialogue quality;
-   realism;
-   tone;
-   narrative sophistication;
-   brutality context;
-   nuanced fit with the viewer profile.

Do not force qualitative human judgment into arbitrary arithmetic merely
because arithmetic is easy to code.

------------------------------------------------------------------------

## Privacy and Data Authority

Real viewing history and preference data are private.

Public repository/deployment content should contain only:

-   application code;
-   schemas;
-   documentation safe for publication;
-   synthetic/demo data.

Private data should remain local unless the owner explicitly chooses
otherwise.

Private stores include, as applicable:

-   titles;
-   viewers;
-   playback events;
-   reactions;
-   identity resolutions;
-   curated title references;
-   candidate evidence;
-   private preference profile;
-   research packets;
-   benchmark cases/results if persisted.

Raw Netflix/Amazon exports must not be committed.

API credentials must never be committed, printed, logged, or embedded in
browser code.

Use ignored local secrets/config files or secure environment mechanisms.

Only the minimum prompt material required for an LLM evaluation should
leave the computer for the chosen provider.

------------------------------------------------------------------------

## Data Design Principles

Prefer:

-   immutable imported playback events;
-   append-only explicit reactions;
-   supersession rather than destructive correction;
-   provenance on derived/curated evidence;
-   deterministic private IDs;
-   reversible enrichment;
-   private backups;
-   open/exportable formats;
-   conservative identity resolution.

Derived behavioral evidence should be recomputable when possible rather
than treated as permanent truth.

Avoid hidden mutations that make it impossible to explain why the system
believes something.

------------------------------------------------------------------------

## Recommendation Explanations

A recommendation should be explainable in human terms.

A useful explanation answers:

-   Why was this candidate discovered?
-   What evidence suggests Viewer 1 will like it?
-   What evidence suggests Viewer 2 will like it?
-   What are the important risks?
-   What is uncertain?
-   Why did it rank above or below another candidate?

Do not present a percentage as though it were an objective probability
unless it has actually been calibrated as one.

Scores are ranking/fit estimates until calibration proves otherwise.

------------------------------------------------------------------------

## Learning Loop

After the viewers watch something:

1.  record the explicit reaction when available;
2.  allow separate reactions for each viewer;
3.  capture concise positive/negative mechanisms when useful;
4.  preserve prior predictions;
5.  compare prediction with outcome;
6.  use prediction errors to improve the profile, research prompts,
    mechanism vocabulary, model choice, or scoring architecture.

Do not automatically change the system after every single surprise. Look
for repeated failure modes.

------------------------------------------------------------------------

## Engineering Workflow

Before significant changes:

1.  inspect current repository state;
2.  understand existing data contracts;
3.  identify privacy implications;
4.  preserve backwards compatibility when practical;
5.  add tests for failure modes discovered during real use.

After changes:

-   run relevant focused tests;
-   run the broader project test suite;
-   run data/private-store validation;
-   run production build;
-   run diff/format checks;
-   inspect Git status;
-   do not commit private material.

When a live bug exposes a missing test, add regression coverage.

Do not commit or push until the owner/architectural workflow calls for
it.

------------------------------------------------------------------------

## Current Architectural Direction

The system has evolved through several stages:

1.  private Netflix/Amazon viewing-history ingestion;
2.  identity resolution and TMDb canonicalization;
3.  explicit preference evidence;
4.  behavioral evidence;
5.  deterministic recommendation scoring;
6.  TMDb candidate discovery;
7.  candidate qualitative evidence;
8.  realization that structured metadata cannot capture decisive taste
    factors;
9.  provider-neutral LLM evaluation harness;
10. benchmark-driven selection of an economical qualitative evaluator.

This evolution is intentional. Earlier deterministic components remain
useful, but they should not constrain the project into pretending
qualitative taste is merely a numerical metadata problem.

------------------------------------------------------------------------

## Important Known Preference Anchors and Lessons

These examples are architectural test cases, not an exhaustive
preference profile.

### The Bureau

Very strong shared positive anchor. Key lesson: credible tradecraft,
professional institutions, patient plotting, competing agendas, serious
adult tone, moral complexity.

### Friday Night Lights

Very strong positive anchor. Key lesson: rootable characters,
naturalistic dialogue, relationships, emotional credibility.

### Silo

Strong shared positive. Key lesson: excellent character execution can
overcome initial dislike of a dystopian/underground premise.

### Slow Horses

Positive but qualified. Key lesson: liking a show does not mean liking
all of its mechanisms. Implausible workplace cruelty and caricatured
behavior should not become inferred positives.

### Virgin River

Viewer disagreement. Viewer 2 strongly likes it; Viewer 1 considers it
only okay. Key lesson: never collapse the two viewers into one profile.

### The Americans

Quality is recognized, but Viewer 1 has significant moral-identification
and extreme-suspense problems. Key lesson: objective quality and
personal fit differ.

### Breaking Bad

Important negative for Viewer 1. Key lesson: central protagonists who
selfishly harm others can destroy rootability even in acclaimed
television.

### Annika

Negative because of the fourth-wall device. Key lesson: specific
storytelling devices can dominate otherwise plausible genre fit.

### A Discovery of Witches

Strong positive anchor. Useful for coherent speculative/fantasy
mechanisms and character engagement.

### Shōgun

Shared positive. Useful for sophisticated adult drama, historical
setting, subtext, competing agendas, and serious character behavior.

------------------------------------------------------------------------

## What Codex Should Do When Instructions Are Incomplete

Do not freeze merely because every design detail has not been specified.

Use the principles in this document to reason about the likely correct
solution.

When uncertain:

1.  protect private data;
2.  preserve provenance and reversibility;
3.  avoid inventing user preferences;
4.  avoid destructive changes;
5.  prefer measurable experiments;
6.  keep qualitative interpretation available to an LLM;
7.  explain the uncertainty and proposed tradeoff.

If a requested change conflicts with these principles, flag the conflict
before implementing it.

------------------------------------------------------------------------

## Long-Term Goal

The eventual user experience should feel simple:

-   open the app;
-   see genuinely promising things to watch;
-   understand briefly why they fit;
-   mark what was watched;
-   say whether each viewer liked it;
-   optionally explain why;
-   let the system improve.

The complexity should live behind that interface.

The goal is not to build the cleverest recommendation algorithm. The
goal is to produce recommendations that these two particular people
consistently enjoy, while preserving privacy, explainability, and the
ability to improve the system as AI capabilities evolve.
