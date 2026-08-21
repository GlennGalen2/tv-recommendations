# TV Recommendations — Project Handoff

## What this is

This is a private, personal TV and movie recommendation app for two people:
Glenn (\`viewer-1\`) and Becky (\`viewer-2\`). Its purpose is not to mimic a
commercial streaming recommender. It should help them decide what to watch
together by combining their real viewing history, explicit reactions, and a
written explanation of *why* each viewer tends to like or dislike a title.

This is a hobby project for two users, not production software. Favor plain,
maintainable code and open local data over enterprise patterns, accounts,
cloud infrastructure, queues, observability stacks, or scaling work. Do not
add abstractions merely to make it look like a commercial service.

## Status and Git state — August 21, 2026

- Product milestone: **v0.8 beta**.
- Current branch: \`codex/v0.8.1\`.
- Baseline checkpoint: \`cd1df50 Create v0.8 beta local recommendation runner\`.
- Nothing has been pushed to GitHub by this work.
- The application has completed a real local batch of 50 researched and
  scored titles successfully. The normal local-runner workflow is therefore
  demonstrated, but still beta rather than proven over long-term use.

The package version remains \`0.0.0\`; that is a technical metadata mismatch,
not the user-facing product designation. Do not silently change it unless the
owner asks for release/versioning cleanup.

## The intended recommendation workflow

1. **History and reactions**: Netflix and Amazon exports are imported in the
   browser. Watching a complete title/series is behavioral evidence, not an
   automatically invented explicit rating. Explicit loved/liked/disliked
   reactions remain distinct and take priority as stated user input.
2. **Identity**: imported titles are resolved against TMDb. Ambiguous matches
   should remain reviewable; do not guess a canonical identity.
3. **Candidate generation (TMDb)**: TMDb supplies canonical metadata, watch
   providers, and possible new movies/series. The app filters titles already
   watched/rated and candidates already researched.
4. **Nano research — not taste culling**: \`gpt-5.4-nano\`, with the OpenAI
   web-search tool, researches public information about each candidate:
   premise, tone, moral framing, violence, reviews, and other relevant
   evidence. It receives public title information, not the private preference
   profile or browser history.
5. **Preference evaluation**: \`gpt-5.4-mini\` receives the private preference
   profile plus Nano's compact research packet and returns structured fit
   scores for both viewers and for them jointly. Nano must not be used to
   discard candidates early based on taste; it is too weak for that decision.
6. **Presentation and feedback**: the simple home screen lists the latest
   recommendations and all recommendations. Save / Watched / Not for us are
   lightweight workflow statuses. They are not automatically folded into the
   enduring preference profile without an explicit design change.

The standing shared preference that must not be lost: neither viewer is
interested in morally grim, violent hitman/criminal-protagonist premises.
All other taste claims must come from application data or the private
preference profile; do not invent them from genre stereotypes.

## Architecture map

### Browser PWA (\`src/\`)

- Vite PWA entry point: \`src/main.js\`; styles: \`src/style.css\`.
- The normal screen is \`src/ui/recommendationHomePanel.js\`:
  **Latest**, **All recommendations**, and **Get more**.
- Less frequently used import, backup, identity, preference, TMDb, and
  diagnostic controls remain under the two expandable workbench sections.
- A synthetic public demo still exists under the developer-test workbench.
  It is deliberately separate from private real-world data.

### Browser-private storage

- \`src/data/privateStore.js\` owns IndexedDB database
  \`tv-recommendations-private\` and its record validation/backups.
- It holds parsed titles, history events, reactions, sources, import batches,
  viewer records, identity resolutions, recommendation imports, preference
  evidence, candidate evidence, and metadata.
- Raw Netflix/Amazon export contents are intentionally not retained.
- Private browser storage is tied to the exact browser origin. In particular,
  \`http://127.0.0.1:5173\` and \`http://127.0.0.1:5174\` have different storage;
  so do different browser profiles. A backup/restore is required to move that
  data between them. Do not mistake the shallow top-of-page demo count for
  the authoritative import/history count; use the analysis and import panels.

### TMDb discovery

- Primary module: \`src/data/tmdbDiscovery.js\`.
- TMDb client/API calls: \`src/data/tmdbDiscoveryClient.js\`.
- Browser-held TMDb credential UI: \`src/ui/tmdbCredentialPanel.js\`.
- Discovery uses a small set of quality cohorts (drama, mystery, political,
  speculative, historical, and acclaimed drama) plus preferred-service
  availability. Candidate batches contain stable TMDb IDs and modest public
  metadata only.
- \`src/data/llmEvaluationBatch.js\` balances the selected candidates across
  discovery cohorts and limits a batch to 50.

### Local LLM runner (\`llm-eval/\`)

- Start service: \`npm run recommendation-runner\` or
  \`Start-TV-Recommendation-Runner.cmd\`.
- Service file: \`llm-eval/localRunnerServer.js\`.
- It listens only on \`127.0.0.1:5119\`; the PWA calls it from the local browser.
- It reads \`OPENAI_API_KEY\` from the environment or the ignored root file
  \`llm-eval.secrets.local.json\`, and reads the ignored preference profile at
  \`llm-eval/private/viewer-preferences.md\`.
- Queues, research packets, and completed evaluations are written under
  ignored \`llm-eval/private/\`. The browser never receives the OpenAI key.
- \`llm-eval/researchQueue.js\` supports resumable sequential work. Queue file
  writes use a temporary file rename with Windows retry handling in
  \`llm-eval/researchQueueStore.js\`.
- The runner returns completed recommendations to the home panel directly;
  it does not currently write those runner results back into browser
  IndexedDB. The UI combines them at display time with imported batches.

### Durable design documentation

\`TV_RECOMMENDATIONS_PROJECT_GUIDE.md\` is the larger architectural and
operating brief. Read it before substantial changes. The private preference
profile is application data, not a source-code instruction file.

## Known issues and unfinished work

1. **TMDb discovery is currently exhausted.** The initial cohort/page recipe
   is fixed and has been consumed after about 235 recommendations. The error
   “No new title was found after searching the wider catalog” means the app
   received only already-known or excluded titles from that finite recipe; it
   does *not* establish that TMDb has no more relevant titles. v0.8.1's likely
   first feature is rotating into new pages and/or broader cohort recipes,
   while retaining deduplication and explanations. Do not start a paid batch
   merely to test discovery without explicit owner approval.
2. **The initial live runner had two reliability problems.** A Windows file
   rename lock was fixed with retry logic, and the runner must be launched in
   an environment allowed to reach the OpenAI API. A 50-title run succeeded
   after those changes, but further reliability testing is prudent.
3. **Costs are only partly surfaced.** The home screen's “$1.50 reservation”
   is a queue guard, not an invoice or a guaranteed cost cap. The queue stores
   token usage, but its \`costUsd\` fields were observed as zero; cost was
   calculated manually from usage and official API pricing. The OpenAI billing
   dashboard is authoritative. A future improvement could display a local
   estimate clearly labelled as an estimate.
4. **Origin/device portability remains rough.** IndexedDB does not follow the
   user between ports, browsers, PCs, or phones. The backup/restore workflow
   exists, but the product does not yet provide a seamless LAN/mobile setup.
5. **Preference maintenance is partly manual.** Editing the Markdown profile
   affects later runner evaluations, but does not automatically rewrite the
   fixed preference dropdown labels. The source of those labels is
   \`src/ui/preferencePanel.js\`. Names in stored IDs must remain \`viewer-1\`
   and \`viewer-2\`; display prose can say Glenn and Becky.
6. **Runner state after a restart is uncertain.** It reads completed queues
   for recommendations, but \`activeRun\` is memory-only. A restarted runner
   cannot report progress for an in-flight run. This should be verified before
   claiming a robust resume/progress experience.
7. **Local runner and deployed PWA are separate concerns.** GitHub Pages can
   host the static PWA but cannot run the Windows-local Node service. The
   normal AI-research workflow requires the Windows machine with the runner
   open.

## Commands

Run these from the repository root in PowerShell.

\`\`\`powershell
npm install
npm run dev
npm run build
npm run recommendation-runner
\`\`\`

The Vite development app has normally been used at
\`http://127.0.0.1:5173/tv-recommendations/\`. The runner's CORS allow-list is
currently limited to port 5173 for \`127.0.0.1\` and \`localhost\`; if Vite uses
another port, the runner will not connect until that allow-list is deliberately
updated.

Focused checks relevant to v0.8.1:

\`\`\`powershell
npm run test:tmdb-discovery
npm run test:llm-candidate-batch
npm run test:llm-research
npm run test:llm-research-queue
npm run test:private-preferences
npm run build
\`\`\`

Other focused checks are defined in \`package.json\`; run the tests nearest to
the changed module. Run \`npm run build\` after front-end changes. There is no
single umbrella test command at this point.

## Privacy, money, and safety rules

- Never commit \`llm-eval/private/\`, \`llm-eval.secrets.local.json\`, local
  \`.local\` files, API keys, raw export data, research dossiers, or backups.
- Do not print a secret in terminal output or a response.
- Starting a research batch sends public candidate information to OpenAI, then
  sends the private preference profile plus the public research notes for
  scoring. It costs API money. Require explicit, immediately preceding owner
  consent before starting or retrying a paid batch.
- Testing a TMDb connection sends the saved browser TMDb token to TMDb; get
  consent before doing so.
- Preserve the difference between a recommendation prediction, imported
  history, and an explicit human reaction.

## Coding and collaboration conventions

- Use ES modules, plain browser JavaScript, DOM-template rendering, and
  small focused data/UI modules. The project intentionally has very few
  dependencies.
- Keep durable data structured and validated. Prefer stable TMDb IDs,
  append-only records/supersession for history and reactions, and explainable
  scoring/provenance.
- Treat the two viewers separately when the data supports it. Do not turn
  “watched” into “loved,” and do not manufacture preference evidence.
- Keep user-facing language calm and direct. The owner is technically capable
  but should not be asked to manually translate normal requests into code.
- Inspect relevant code before editing. Use incremental changes, add/update
  focused tests, and run an appropriate validation command.
- Do not commit, push, force-push, rewrite history, or delete branches unless
  the owner explicitly authorizes that specific operation. Git is the safety
  system, not a deployment command.
- If a design claim is uncertain, say so. In particular, distinguish observed
  successful behavior from a guarantee that a local network/API workflow will
  work in every environment.

## Suggested first task on v0.8.1

Design and implement rotating, explainable TMDb discovery pools so repeated
Get-more requests can find fresh candidates after the initial cohort pages are
exhausted. Keep the changes deterministic and testable, preserve exclusions,
and do not initiate an OpenAI run as part of development or testing unless
the owner expressly asks at that time.
