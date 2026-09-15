# ePublisher Phase 1 STT Specification

Status: implementation gate, 2026-09-15.

## Phase 1 scope

1. Deterministic audio extraction and normalization.
2. ASR transcription with immutable raw JSON.
3. Separate forced-alignment stage for real word timestamps.
4. Separate optional speaker-diarization stage.
5. Readable Markdown plus SRT and VTT exports.
6. Versioned QA report and processing/evidence manifest.

## Model consistency

- `production` resolves to `large-v3` everywhere.
- `balanced`/fast modes may use `large-v3-turbo`; they must not be recorded as production.
- A processing report records both `requestedModel` and `resolvedModel`.
- If `large-v3` is unavailable and a fallback is used, set `degradedModel=true`; that run is not production-qualified.
- Ealiophin currently has `whisper-small`; it remains a fallback until `large-v3` is installed and verified.

## Stage separation

ASR, alignment and diarization are separate executable stages with separate status/output fields. A configuration flag never implies a stage was performed.
### Stage A — audio preparation

Normalize to 16 kHz mono PCM WAV and record the exact FFmpeg command, input/output hashes and audio metrics. Denoise is opt-in/auto-detected, never unconditional.

### Stage B — ASR

Use faster-whisper with the resolved model. Preserve model-native segments, language, probabilities/log-probability fields and VAD metadata in `transcript.raw.json`. Never edit this file.

The current local service's `words` list is interpolated from segment duration and token count. It must be renamed/treated as approximate and must not be advertised as aligned word timestamps.

### Stage C — forced alignment

Run WhisperX-style language-specific forced alignment after ASR. Write `transcript.aligned.json`. Preserve the ASR raw JSON unchanged. If the language has no supported alignment model, record `alignmentStatus="unsupported"` rather than fabricating timings.

### Stage D — diarization

Run diarization independently after alignment when explicitly enabled and its model/token requirements are satisfied. Write `speaker-map.json` and speaker-labelled aligned segments. If disabled or unavailable, record that state explicitly.

### Stage E — exports

Generate `transcript.clean.md`, SRT and VTT from aligned timestamps when alignment succeeded; otherwise use ASR segment timestamps and mark captions `segmentTimed=true`.
## QA confidence definition

Do not activate the proposed `0.86` or `0.60` thresholds yet.

Primary ASR confidence is a calibrated segment-accuracy estimate, not a hand-mixed score. For segments with word probabilities, compute `rawAsrConfidence = mean(wordProbability)` across lexical words. Where only `avg_logprob` exists, expose `exp(avg_logprob)` as `uncalibratedLogprobSurrogate`; do not threshold it as if it were a probability of correctness.

Keep other dimensions separate:

- `alignmentCoverage = alignedLexicalWords / transcriptLexicalWords`.
- `speakerCoverage = speakerAssignedAlignedWords / alignedWords` when diarization is enabled.
- audio QA records clipping, silence/speech duration, peak level and normalization outcome.
- report confidence distribution (p10/p50/p90) and missing-confidence counts.

## Threshold validation gate

Create a manually corrected representative validation corpus and calculate WER/CER per segment. Fit a versioned calibration mapping from raw ASR confidence to observed segment accuracy on a calibration split, then verify on a held-out split. Thresholds are stored with model, language, calibration-corpus ID and date in `qa-calibration.json`.

`0.86` and `0.60` become enforceable only if hold-out validation supports them. Until then, QA may report provisional values but must not classify a run as pass/fail from those numbers.

Phase 1 acceptance requires reproducible artifacts, unchanged raw evidence, real stage-status fields, and tests proving exports derive from the correct timestamp source.
