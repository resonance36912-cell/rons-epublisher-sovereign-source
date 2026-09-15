# Resonance ePublisher — Open Nova Sovereign Local v0.1.0

This document describes the current sovereign-local implementation boundaries. It does not by itself authorize a production/pilot dispatch or establish hosted-service behavior.

## Runtime boundary
- Primary UI: `http://localhost:3101/app` (loopback).
- Lovable authentication/runtime is disabled in sovereign-local mode.
- Hosted billing, quota and entitlement lookups are bypassed in sovereign-local mode; the billing-path fix is a local bypass, not a remote CORS repair.
- Project list/load/save uses the local project-backup path in sovereign-local mode. Project-changing state is marked dirty and the project manager attempts autosave every 30 seconds while dirty; manual save remains available.
- External AI is disabled by default. Any optional governed external/free-tier routing must be explicit and must retain local fallback/governance controls.

## Story structure
- Governed story-page generation uses `StoryConfig.targetStoryPages` when an approved exact count is supplied. The deterministic formatter enforces the requested count or errors rather than inventing missing content.
- Without an exact brief, local formatter budgets are depth-dependent: Summary max 6, Standard max 12, Extensive max 20 story pages.
- This is distinct from the legacy **Use As-Is** path, which groups paragraph blocks directly and applies a separate `MAX_CHAPTERS = 30` cap. That legacy paragraph-group cap is not the governed story-page-count contract.

## Sovereign research
- The current research gateway is the local Open Nova research service, not the older hosted pipeline.
- Credential-free discovery providers implemented in the current service are **Bing RSS**, **Wikipedia search**, and **YouTube public search**; YouTube extraction uses publicly exposed captions when available.
- Default governance policy `max_sources` is **12** (configurable within the service hard bounds); do not document an older hosted-source maximum as current behavior.
- The research service fetches public internet sources through its governed network boundary while the browser UI continues to call the local gateway.

## Upload acceptance versus extraction support
- Upload UI accepts: PDF, DOC, DOCX, TXT, MD, RTF, CSV, XLSX, XLS, MP3, WAV, M4A, OGG, FLAC, AAC, WMA, MP4, MOV, AVI, MKV and WEBM.
- Direct browser text extraction in `SourceInput` is currently implemented for **TXT, MD, CSV and RTF** via `File.text()`.
- Other accepted document/media types are stored as binary/base64 source content in this path. Acceptance must not be described as equivalent extraction/transcription support.
- Web/YouTube extraction is handled separately by the sovereign research service; uploaded media transcription is not implied by the file-accept list.

## Image and narration modes
- Chapter image generation calls the local image service on `127.0.0.1:7865`; it uses the local SD-Turbo pipeline when the model is complete/GPU-capable and otherwise returns the service's procedural local fallback.
- Sovereign-local narration returns the browser speech-engine fallback and does not call cloud TTS.
- Hosted mode retains its separate narration routing: browser fallback, eco/free-provider behavior, and premium ElevenLabs path are mode/quota dependent. Those hosted paths are not established by local-mode tests.

## Billing-path verification boundary
- Sovereign-local pricing lookup suppresses the Hub billing-catalog request.
- Sovereign-local credit-pack lookup returns seeded local packs without querying Supabase.
- The non-local lookup path must remain reachable; preserving that path is not proof that remote billing/CORS is healthy.
- **Manual-link priority: unverified.**
- **Success-only credit charging: unverified.**

## Pilot boundary
This software repair does not establish protocol freeze, dry-run completion, or permission to dispatch pilot work. Prepared execution materials that reference a changed build/configuration must be reconciled before freeze.
