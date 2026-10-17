# DRAG & DROP Story Lab

A separate test pipeline: **simple episode description -> Codex CLI + the exact
Scene Builder Skill -> timed Higgsfield prompts -> MiniMax H3 clips -> Codex visual
QA -> one assembled episode**. This does not modify or reuse an old production
workflow's episode state.

## What you write

Edit one short Markdown file per episode. Do not write camera directions, clip
prompts, JSON or detailed timestamps. The director does that work.

```markdown
---
status: ready
---
# Episode 1 - The Click That Answered

Jack and Karega investigate a missing file in their ruined server room. The
computer plays a click before Jack touches anything. As their argument becomes
an investigation, they realize the machine is anticipating them. Jack takes both
hands away, but the cursor moves the file anyway. End on an unexplained click.
```

The supplied Episode 1 is ready for the pilot. Episodes 2-8 are **drafts** and will
not dispatch until you deliberately change their status. These are new Story Lab
stories, not replacements for already accepted production episodes.

## What the system creates

Codex chooses **4-8 sequential 15-second clips**, giving an episode of **60, 75,
90, 105 or 120 seconds**. Prefer story fit over arbitrary randomness. The chosen
length and plan are saved once, so retrying never changes episode length.

- MiniMax H3 (`minimax_h3`), 2K / 1440 x 2560, 9:16, batch size 1.
- Jack and Karega's existing approved identity sheets; Jack = Grady, Karega = Arthur.
- Existing ruined-server-room reference; no newly invented characters or props.
- Native dialogue, timed SFX, room ambience and quiet original instrumental music
  direction in every clip prompt. Target 16-24 spoken words for dialogue-led clips,
  with time for reactions. Silent action is allowed when useful.
- A fresh episode opening. Later clips use the immediately previous accepted
  final frame as a regular image reference, together with identity sheets. No
  native `start_image` mixed with regular image references.
- Exactly one physical instance of each character. Valid connected anatomy and
  separation from the solid console are hard QA requirements.

The controller formats Codex's structured shot decisions; it does not substitute
prewritten episode prompt blocks for a real Codex directing pass. Source and Skill
hashes are recorded, and the exact local Skill is included in the Codex input.

## Contents

| Path | Purpose |
|---|---|
| `episodes/season-01/episode-01.md` | The first simple test story |
| `episodes/season-01/episode-02.md` through `episode-08.md` | Draft connected story descriptions |
| `project-bible.md` | Shared character, setting and art direction |
| `production.json` | Fixed model/format and duration choices |
| `.agents/skills/cartoon-scene-builder/` | Enhanced Skill used by Codex |
| `provenance/` | Byte-exact original supplied Skill and its hashes |
| `schemas/` | Structured episode, clip and visual-QA contracts |
| `runtime/` | Small shared controller, guards and one-time server installer |
| `n8n/workflow.json` | Importable 14-node workflow, disabled by default |
| `n8n/workflow.ts` | Corresponding n8n Workflow SDK source |
| `.github/workflows/episode-production.yml` | Push/manual-dispatch intake |
| `tests/core.test.mjs` | Offline safety and contract tests |

The 14-node canvas shows the real orchestration stages. Repeated validation,
checkpoint and media operations live in the reviewable shared controller, not in
many duplicate n8n nodes. It is not a single opaque AI agent with spending access.

## One-time setup

1. Create a public repository, suggested name **`drag-and-drop-story-lab`**, and
   commit this directory's contents at the repository root, including hidden
   `.agents` and `.github` directories. Use the `main` branch. No secret, private
   asset URL, or account-specific media ID is included in this starter.
2. Use the newly created Story Lab n8n workflow, or import `n8n/workflow.json` into
   another instance. Do not import another duplicate into the existing test
   instance. Connect the Higgsfield MCP account and inbound Header Auth credential.
   Prefer a dedicated Story Lab header secret before exposing its webhook.
3. On the n8n host/container, as the same user that runs production and from a
   **reviewed checkout**, run `sh runtime/install.sh`. It only installs into
   `/files/dnd-story-lab/`. The old production directory is untouched. The installer
   preserves an existing private operator configuration.
4. Edit `/files/dnd-story-lab/operator.json` on the server. Fill the exact
   `allowed_repository` (`OWNER/drag-and-drop-story-lab`), keep branch `main`, and
   enable only Episode 1 initially. Set the executable paths to the installed
   FFmpeg/ffprobe. `codex login status` must report ChatGPT login. A configured
   Codex model is optional; empty `codex_model` uses the authenticated CLI's
   default. Reasoning is `medium`. No OpenAI API key fallback is used.
5. Verify/pin the existing completed Jack, Karega and room Elements privately in
   `approved_elements`. Format per tag: `{"element_id":"...","media_id":"..."}`.
   An empty mapping only permits unique completed name/media matches, not invented
   references. Recheck asset identity before the first paid run.
6. In the GitHub repository, create secrets `DND_N8N_URL` (the **production** URL
   shown by the Story Lab webhook) and `DND_WEBHOOK_TOKEN` (the complete exact
   Authorization header value configured in n8n). Neither belongs in a commit.
   Add repository variable `DND_MODE=plan` for the initial no-generation check.
7. Publish/activate the **new** workflow only after that configuration. Run GitHub
   Actions **Story Lab episode production -> Run workflow**, Episode 1, mode
   `plan`. Verify the saved real Codex plan and its hashes. A plan is not a video.
8. After approving the generation budget, set `render_enabled=true` and an explicit
   `max_credits_per_episode` in the private operator config. At the initial
   30-credit-per-clip quote, a 90-second first pass is 180 credits; a 120-second
   first pass is 240. The default two total repair jobs can add up to 60. Every
   clip is requoted; a price above the private per-clip cap blocks spending.
   Dispatch mode `render` for the same commit to render that saved plan.
9. For subsequent commit-triggered runs, set GitHub variable `DND_MODE=render`.
   Changes to one enabled, ready episode description on `main` then initiate
   production. Future episodes require explicit addition to the server allowlist.

The pilot deliberately accepts **one ready episode per push**. A multi-episode
queue is not hidden in the workflow. Commit later episodes individually or use
manual dispatch. PRs and forks do not get the production-secret trigger.

The controller fetches only story, Bible, settings and Skill text from the pinned
commit. It does not automatically execute new runtime code pushed to a public
repository. Runtime changes require review and a deliberate installer rerun.

## Inspect the result

The n8n **Episode Result and Honest QA Status** node returns the final playable
upload URL and server file path. The output and `delivery-manifest.json` live in
`/files/dnd-story-lab/runs/<run-id>/`. The manifest records source hashes, selected
duration, accepted job IDs and QA limitations. These files are private runtime
outputs; the system does not publish videos or logs into the public GitHub repo.

GitHub's successful request means n8n **accepted the request**, not that the video
has finished or passed QA. Check the n8n execution and final result.

## Recovery and limits

- One saved job at a time. Poll existing job IDs rather than submitting duplicates.
- Reserve credits before a paid request; persist the returned job ID immediately.
- One retry per clip, with two repair jobs maximum per episode by default. Accepted
  neighboring clips are not regenerated. Repair preserves dialogue and story beats.
- Unknown submission outcomes stop for reconciliation. Authentication failures,
  incomplete visual evidence, missing assets, schema failures, exhausted budgets
  and exhausted retries are real blockers, not silent passes.
- After a stopped execution, use manual dispatch with `resume=true` only after
  checking its saved state. Do not blindly retry an uncertain paid submission.
- A changed story/Skill/Bible/settings fingerprint does not silently rerender an
  existing episode. Review a new plan explicitly before changing the production
  fingerprint. Unrelated commits reuse the saved result.
- FFmpeg normalizes each accepted clip to 15 seconds and assembles with timestamp
  normalization so the final runtime does not exceed 120 seconds from AAC padding.
  FFmpeg must support the `setts` bitstream filter (checked by the installer).

## Honest QA

Codex examines identity references, full-clip chronological samples, denser end
samples, the final decoded frame, and the previous clip's end. Clear extra limbs,
body-console penetration or missing/reversed central action fail even when the
scene otherwise looks good. Normal camera cuts and cropped details do not.

This is **sampled visual QA**, not inspection of every video frame. Actual dialogue,
voice identity, music/SFX fidelity and lip sync remain **unverified** by image-only
QA. The controller checks an audio stream and non-silence; it does not call that an
audio-content pass. Native audio instructions improve the production request, but
do not guarantee the delivered soundtrack. The result is labeled with limitations.

## Tests and boundaries

Run `npm test` with Node 22+. Tests are offline and submit no generation jobs.
A passing schema/unit/health check is not an end-to-end video-production test.
The real public-repository intake, Codex plan, Higgsfield submission, visual repair
and delivered Episode 1 must be verified together once the new repo is configured.

This starter contains no OpenAI API generation node. The director and QA use the
ChatGPT-authenticated Codex CLI. If login fails, fix that login; never switch to
API billing automatically.
