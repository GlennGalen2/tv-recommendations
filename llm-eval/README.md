# Local LLM evaluation benchmark

This Node-only calibration harness is not imported by the PWA and never reads IndexedDB, browser credentials, or playback history. It sends only the profile Markdown and one research packet to the provider selected on the command line.

Use a private, ignored profile file for real preferences. The checked-in profile and fixtures are synthetic placeholders. Credentials are read from `OPENAI_API_KEY` when it is set; otherwise the harness reads the ignored `llm-eval.secrets.local.json` file in the repository root:

```json
{
  "OPENAI_API_KEY": ""
}
```

Never commit that file or include its value in diagnostics.

```powershell
$env:OPENAI_API_KEY = 'local-secret'
npm run llm:eval -- --provider openai --model <model> --benchmark llm-eval/fixtures/synthetic-benchmark.json --profile .\llm-eval\private\viewer-preferences.md
```

For an OpenAI-compatible endpoint, pass `--provider openai-compatible --base-url <url>`. For comparisons, create ignored `llm-eval.config.local.json` with shared `profile`, `benchmark`, and a `models` array containing `provider`, `model`, `apiKeyEnv`, and optional endpoint/baseUrl values, then run `npm run llm:compare -- --config llm-eval.config.local.json`.

Research-packet JSON supports `title`, `year`, `mediaType`, `synopsis`, review excerpts/summaries, critical observations, moral/protagonist notes, violence, dialogue/tone, professional-realism and storytelling notes, and `sources` provenance. The evaluator treats omitted traits as unknown.

## Private holdouts and result reports

Keep real holdout configuration in the ignored `llm-eval/private/` directory. Copy [`holdout-manifest.template.json`](templates/holdout-manifest.template.json) there, then add explicit profile markers around the private anchor prose that must be excluded:

```markdown
<!-- llm-anchor:private-anchor-id:start -->
Private anchor prose to exclude for this holdout.
<!-- llm-anchor:private-anchor-id:end -->
```

Each manifest entry maps one private benchmark case ID to one or more marker IDs. A holdout evaluation refuses to run if the manifest or any marker is missing; it never edits the source profile. To run one held-out case and save its private report locally:

```powershell
npm run llm:eval -- --provider openai --model <model> --profile .\llm-eval\private\viewer-preferences.md --benchmark .\llm-eval\private\benchmark.json --holdout-manifest .\llm-eval\private\holdout-manifest.json --holdout-case <private-case-id> --results-dir .\llm-eval\private\results
```

The results directory is ignored by Git. Result reports are written by a temporary-file rename, so an interrupted write does not replace a completed report. They are private benchmark artifacts and are never read by the PWA or stored in IndexedDB.

## Private discovered-candidate evaluations

The PWA can download up to 50 joint-eligible TMDb discovery candidates as a private JSON batch. This is a deliberate, user-directed export: it does not send anything to OpenAI and it does not contain browser credentials. Save it somewhere under the ignored `llm-eval/private/` directory.

For every exported candidate, create a private research packet using the existing evaluator input contract. Name each packet `<mediaType>-<tmdbId>.json` (for example, `tv-12345.json`) in an ignored private research directory. Then run the local Node evaluator:

```powershell
npm run llm:evaluate-candidates -- --provider openai --model <model> --profile .\llm-eval\private\viewer-preferences.md --candidates .\llm-eval\private\candidates\candidate-batch.json --research-dir .\llm-eval\private\candidate-research --results-dir .\llm-eval\private\results
```

The harness evaluates candidates sequentially, writes only its private result report, and never writes to IndexedDB. Import that result through the PWA's **Discovered Recommendations** panel only after its local preview succeeds. Imported LLM evaluations are predictions for review; they are kept separate from reactions and source history, and never become preference evidence automatically. Private backups include an imported evaluation batch as a typed recommendation record, but never include credentials.

## Private web-research pilot

TMDb supplies catalog metadata but does not provide reliable qualitative criticism. The Node-only research command can use the OpenAI Responses web-search tool to prepare one compact, cited research packet. It sends the public candidate title, media type, and optional year—not the private viewer profile, history, or browser data—to the research call. The resulting packet is written only under `llm-eval/private/` and can then be reviewed or used by the separate evaluator.

```powershell
npm run llm:research-one -- --model gpt-5.4-nano --title "Example Series" --media-type tv --year 2025 --output-dir .\llm-eval\private\candidate-research --output-name tv-example.json
```

The research packet holds concise, source-attributed observations rather than copied reviews. It records moral framing, violence, dialogue/tone, professional realism, storytelling, and explicit uncertainty. It never writes a reaction, changes a recommendation score, or reaches the PWA's IndexedDB.

To evaluate one reviewed private packet, explicitly supply the ignored profile and packet paths. This sends those two inputs to the selected model, prints only the structured evaluation, and does not save to IndexedDB or the public project.

```powershell
npm run llm:evaluate-one -- --provider openai --model <model> --profile .\llm-eval\private\viewer-preferences.md --research .\llm-eval\private\candidate-research\tv-12345.json
```

## Private resumable research queue

For a Windows-local batch, first create an ignored queue from a private candidate batch. The cost cap is a conservative reservation used to stop the queue before starting another candidate; it is not a billing estimate. The queue runs sequentially and records only safe error categories. A completed research packet is reused if the later evaluation fails, so retrying does not repeat its web-research call.

```powershell
npm run llm:queue-create -- --candidates .\llm-eval\private\candidates\candidate-batch.json --queue .\llm-eval\private\queues\weekly.json --max-cost-cents 100 --reserved-cost-cents 3
npm run llm:queue-run -- --provider openai --research-model gpt-5.4-nano --evaluation-model gpt-5.4-mini --profile .\llm-eval\private\viewer-preferences.md --queue .\llm-eval\private\queues\weekly.json --research-dir .\llm-eval\private\candidate-research --limit 10
```

Retry failed work deliberately with `--retry-failed true`. The queue, dossiers, and evaluations stay under ignored `llm-eval/private/`; it does not write to IndexedDB or the public PWA.

`--model <model>` remains supported for existing one-model queues. When supplied, it is used for both research and evaluation unless either explicit model flag overrides it.

## Windows-local recommendation runner (v1)

The normal app workflow uses a local-only companion service, so no Codex supervision is needed for a recommendation run. Start it in a PowerShell window in the repository root:

```powershell
npm run recommendation-runner
```

It listens only on `127.0.0.1:5119`. The PWA can send it a selected batch of public TMDb title data. The runner reads the private profile and `OPENAI_API_KEY` only from ignored local files, uses Nano for web research and Mini for scoring, and writes queues/results only under ignored `llm-eval/private/`. The browser never receives the key.

With the runner open, use **Get more** in the app to start a capped batch. The app displays completed recommendations directly from the local runner; they are kept separate from the public demo data and do not automatically become preference evidence.
