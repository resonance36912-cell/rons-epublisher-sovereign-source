# Queued ePublisher transcription

Deploy the RONSAS STT service change before promoting the ePublisher client.
The client now requires POST /open-nova-stt/transcription-jobs and
GET /open-nova-stt/transcription-jobs/{jobId}. Preserve the existing proxy,
authentication, and origin controls. The loopback health response advertises
transcription_jobs: true after the updated service starts.

Submission returns 202 immediately. A single worker shares the existing
transcription semaphore with uploads and legacy requests. Duplicate canonical
YouTube URL/mode/profile submissions reuse active or completed jobs. The queue
stores at most 32 jobs, evicts terminal results under pressure, and expires
terminal results after one hour. Requests beyond active capacity return 429.
Job IDs are unguessable retrieval capabilities; responses are not cacheable.
Do not expose the loopback service directly to the internet.

State is process-local. Service restart loses job records; the client reports
expired/missing jobs rather than silently launching synchronous work. A retry
reconnects while the original job remains retained. Browser stop/unmount aborts
polling and prevents late UI updates; it does not kill shared server work.
The browser stops waiting after 30 minutes and offers retry through the existing
recovery action. Individual transport requests time out after 15 seconds and
retry at most twice; the service retries transient source acquisition once.
YouTube access denials remain failures and request supplied audio/transcripts.
No credentials, restriction bypasses, or paid providers are introduced.

Validation: Python queue/HTTP contract tests exercise immediate 202, deduplication,
shared capacity, bounded queue, expiry, retry limits, denied origins, empty speech,
and failures. ePublisher tests cover polling, lost responses, cancellation,
deadlines, provenance and missing service behavior. A zero-evidence UI check must
show the warning heading, never a success checkmark or evidence-backed continuation.

Promotion: merge reviewed PRs after CI, update canonical STT runtime via the
existing governed service promotion, restart at an idle boundary, confirm health,
then build and promote ePublisher. Verify a permitted source end to end before
claiming the four reported videos recovered. Roll back the client first if needed;
the updated service retains legacy /transcribe and /transcribe-url routes.
