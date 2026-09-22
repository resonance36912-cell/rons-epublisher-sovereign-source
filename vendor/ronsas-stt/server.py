import hashlib, importlib.metadata, json, os, re, sys, tempfile, threading, traceback, wave
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from statistics import mean
from urllib.parse import parse_qs, urlparse

RUNTIME_ROOT = Path(__file__).resolve().parent
MODELS_ROOT = Path(os.environ.get('RONS_STT_MODELS_ROOT', str(RUNTIME_ROOT / 'models')))
PORT = int(os.environ.get('RONS_STT_PORT', '7864'))
HOST = (os.environ.get('RONS_STT_HOST', '127.0.0.1').strip() or '127.0.0.1')
SERVICE_NAME = (os.environ.get('RONS_STT_SERVICE_NAME', 'epublisher-local-stt').strip() or 'epublisher-local-stt')
PROVIDER_NAME = (os.environ.get('RONS_STT_PROVIDER', 'rons-local-faster-whisper').strip() or 'rons-local-faster-whisper')
YTDLP_JS_RUNTIME = (os.environ.get('RONS_YTDLP_JS_RUNTIME', 'node').strip().lower() or 'node')
_DEFAULT_ALLOWED_ORIGINS = (
    'http://127.0.0.1:3301', 'http://localhost:3301',
    'http://127.0.0.1:3101', 'http://localhost:3101',
)
_EXTRA_ALLOWED_ORIGINS = tuple(
    origin.strip() for origin in os.environ.get('RONS_STT_ALLOWED_ORIGINS', '').split(',') if origin.strip()
)
ALLOWED_ORIGINS = tuple(dict.fromkeys(_DEFAULT_ALLOWED_ORIGINS + _EXTRA_ALLOWED_ORIGINS))
REQUIRE_ORIGIN = os.environ.get('RONS_STT_REQUIRE_ORIGIN', '').strip().lower() in ('1', 'true', 'yes', 'on')
YOUTUBE_MAX_DURATION = int(os.environ.get('RONS_YOUTUBE_STT_MAX_SECONDS', '3600'))
MAX_ACTIVE_STT = max(1, int(os.environ.get('RONS_STT_MAX_ACTIVE', '1')))
VALIDATION_PATH = Path(os.environ.get('RONS_STT_VALIDATION', str(MODELS_ROOT / 'epublisher-stt-validation.json')))
_STT_GATE = threading.BoundedSemaphore(MAX_ACTIVE_STT)
_MODEL_LOCK = threading.Lock()
_MODEL_CACHE = {}
_DLL_DIR_HANDLES = []

def _activate_nvidia_runtime():
    candidates = [
        Path(sys.prefix) / 'Lib' / 'site-packages' / 'nvidia' / 'cublas' / 'bin',
        Path(sys.prefix) / 'Lib' / 'site-packages' / 'nvidia' / 'cudnn' / 'bin',
        Path(sys.prefix) / 'Lib' / 'site-packages' / 'nvidia' / 'cuda_nvrtc' / 'bin',
    ]
    active = [str(path) for path in candidates if path.is_dir()]
    if active:
        os.environ['PATH'] = os.pathsep.join(active + [os.environ.get('PATH', '')])
        if os.name == 'nt' and hasattr(os, 'add_dll_directory'):
            for directory in active:
                try: _DLL_DIR_HANDLES.append(os.add_dll_directory(directory))
                except OSError: pass
    return active

NVIDIA_RUNTIME_DIRS = _activate_nvidia_runtime()

def _cuda_runtime_ready():
    if os.name != 'nt': return False
    required = ('cublas64_12.dll', 'cudnn64_9.dll')
    return all(any((Path(directory) / dll).is_file() for directory in NVIDIA_RUNTIME_DIRS) for dll in required)

MODEL_PATHS = {
    'large-v3': Path(os.environ.get('RONS_WHISPER_LARGE_V3', str(MODELS_ROOT / 'faster-whisper-large-v3'))),
    'large-v3-turbo': Path(os.environ.get('RONS_WHISPER_LARGE_V3_TURBO', str(MODELS_ROOT / 'faster-whisper-large-v3-turbo'))),
    'whisper-small': Path(os.environ.get('RONS_WHISPER_SMALL_CT2', str(MODELS_ROOT / 'faster-whisper-small'))),
}
LEGACY_SMALL_PATH = Path(os.environ.get('RONS_WHISPER_LEGACY_SMALL', str(MODELS_ROOT / 'whisper-small')))

PROFILE_SPECS = {
    'production': {'requested_model': 'large-v3', 'candidates': ['large-v3', 'whisper-small'], 'beam_size': 5},
    'balanced': {'requested_model': 'large-v3-turbo', 'candidates': ['large-v3-turbo', 'large-v3', 'whisper-small'], 'beam_size': 3},
    'fast': {'requested_model': 'large-v3-turbo', 'candidates': ['large-v3-turbo', 'whisper-small', 'large-v3'], 'beam_size': 1},
}
MODE_TO_PROFILE = {'best': 'production', 'accurate': 'balanced', 'fast': 'fast'}

class SourceAcquisitionError(RuntimeError):
    def __init__(self, status, code, reason, retryable):
        super().__init__(reason)
        self.status, self.code, self.reason, self.retryable = status, code, reason, retryable


def _is_ct2_model(path: Path):
    weights = path / 'model.bin'
    return path.is_dir() and weights.is_file() and weights.stat().st_size > 10_000_000 and (path / 'config.json').is_file()


def _is_transformers_model(path: Path):
    return path.is_dir() and (path / 'model.safetensors').is_file() and (path / 'config.json').is_file()


def _backend_info():
    try:
        import faster_whisper  # noqa: F401
        return {'available': True, 'name': 'faster-whisper', 'version': importlib.metadata.version('faster-whisper')}
    except Exception as exc:
        return {'available': False, 'name': 'faster-whisper', 'error': str(exc)}


def _validation_record():
    try:
        data = json.loads(VALIDATION_PATH.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def model_inventory():
    inv = {}
    roles = {'large-v3': 'preferred-production', 'large-v3-turbo': 'preferred-balanced', 'whisper-small': 'fallback'}
    for name, path in MODEL_PATHS.items():
        inv[name] = {
            'available': _is_ct2_model(path),
            'runnableFormat': 'ctranslate2' if _is_ct2_model(path) else None,
            'role': roles[name],
            'path': str(path),
        }
    inv['whisper-small-transformers-legacy'] = {
        'available': _is_transformers_model(LEGACY_SMALL_PATH),
        'runnableFormat': None,
        'role': 'legacy-not-routed',
        'path': str(LEGACY_SMALL_PATH),
    }
    return inv


def resolve_profile(profile='production'):
    profile = profile if profile in PROFILE_SPECS else 'production'
    spec, inv = PROFILE_SPECS[profile], model_inventory()
    resolved = next((name for name in spec['candidates'] if inv[name]['available']), None)
    requested = spec['requested_model']
    quality = 'unavailable'
    if resolved == 'large-v3' and profile == 'production': quality = 'production-local'
    elif resolved in ('large-v3', 'large-v3-turbo'): quality = 'balanced-local'
    elif resolved == 'whisper-small': quality = 'fallback-local'
    return {
        'requestedProfile': profile,
        'requestedModel': requested,
        'resolvedModel': resolved,
        'modelPath': str(MODEL_PATHS[resolved]) if resolved else None,
        'beamSize': spec['beam_size'],
        'qualityTier': quality,
        'maximumQualityAvailable': bool(inv['large-v3']['available']),
        'upgradeRecommended': resolved != requested,
        'degradedModel': resolved != requested,
    }


def health_payload():
    backend, inv, validation = _backend_info(), model_inventory(), _validation_record()
    resolution = resolve_profile('production')
    validated = validation.get('status') == 'pass' and validation.get('resolvedModel') == 'large-v3'
    service_ready = backend.get('available', False) and resolution.get('resolvedModel') is not None
    production_ready = bool(service_ready and resolution['resolvedModel'] == 'large-v3' and validated and _cuda_runtime_ready())
    reason = None
    if not backend.get('available'): reason = 'faster-whisper backend is unavailable.'
    elif not resolution.get('resolvedModel'): reason = 'No runnable CTranslate2 Whisper model is installed.'
    elif resolution['resolvedModel'] != 'large-v3': reason = 'Preferred production model large-v3 is not installed.'
    elif not validated: reason = 'large-v3 is installed but has not passed the production smoke validation.'
    elif not _cuda_runtime_ready(): reason = 'large-v3 is validated but the governed CUDA runtime is unavailable.'
    return {
        'ok': service_ready, 'model_ready': service_ready, 'service': SERVICE_NAME, 'status': 'up' if service_ready else 'degraded',
        'endpoint': f'{HOST}:{PORT}', 'backend': backend, 'models': inv,
        'defaultResolvedModel': resolution.get('resolvedModel'), 'productionReady': production_ready,
        'maximumQualityAvailable': resolution['maximumQualityAvailable'], 'validation': validation or None,
        'cudaRuntimeReady': _cuda_runtime_ready(), 'cudaRuntimeDirs': NVIDIA_RUNTIME_DIRS,
        'reason': reason, 'port': PORT,
    }


def _load_model(resolution):
    from faster_whisper import WhisperModel
    import ctranslate2
    name, path = resolution['resolvedModel'], resolution['modelPath']
    if not name or not path:
        raise RuntimeError('No runnable local Whisper model is available')
    gpu_available = ctranslate2.get_cuda_device_count() > 0 and _cuda_runtime_ready()
    attempts = [('cuda', 'int8_float16'), ('cpu', 'int8')] if gpu_available else [('cpu', 'int8')]
    last_error = None
    for device, compute_type in attempts:
        key = (name, device, compute_type)
        with _MODEL_LOCK:
            if key in _MODEL_CACHE:
                return _MODEL_CACHE[key], {'device': device, 'computeType': compute_type}
            try:
                model = WhisperModel(path, device=device, compute_type=compute_type, local_files_only=True)
                _MODEL_CACHE[key] = model
                return model, {'device': device, 'computeType': compute_type}
            except Exception as exc:
                last_error = exc
    raise RuntimeError(f'Unable to load {name}: {last_error}')


def _profile_from_request(mode, profile=None):
    if profile in PROFILE_SPECS:
        return profile
    return MODE_TO_PROFILE.get((mode or '').lower(), 'production')


def _normalize_audio(raw: bytes, _suffix: str, workdir: Path):
    import av
    src, wav = workdir / 'input.media', workdir / 'audio.wav'
    src.write_bytes(raw)
    resampler = av.AudioResampler(format='s16', layout='mono', rate=16000)
    samples_written = 0
    try:
        with av.open(str(src)) as container, wave.open(str(wav), 'wb') as output:
            audio_stream = next((stream for stream in container.streams if stream.type == 'audio'), None)
            if audio_stream is None:
                raise RuntimeError('Input media does not contain an audio stream')
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(16000)
            for frame in container.decode(audio_stream):
                for converted in resampler.resample(frame):
                    pcm = converted.to_ndarray()
                    output.writeframes(pcm.tobytes())
                    samples_written += int(pcm.size)
            for converted in resampler.resample(None):
                pcm = converted.to_ndarray()
                output.writeframes(pcm.tobytes())
                samples_written += int(pcm.size)
    except Exception as exc:
        raise RuntimeError(f'Unable to decode audio locally: {exc}') from exc
    if samples_written <= 0 or not wav.is_file() or wav.stat().st_size <= 44:
        raise RuntimeError('Audio decode produced no PCM samples')
    return wav, {'sampleRate': 16000, 'channels': 1, 'filter': 'pyav-resample', 'codec': 'pcm_s16le'}


def transcribe(raw: bytes, suffix: str, mode: str, profile=None):
    requested_profile = _profile_from_request(mode, profile)
    resolution = resolve_profile(requested_profile)
    if not resolution['resolvedModel']:
        raise RuntimeError('No runnable CTranslate2 Whisper model is installed')
    with tempfile.TemporaryDirectory(prefix='rons-stt-') as td:
        wav, normalization = _normalize_audio(raw, suffix, Path(td))
        model, runtime = _load_model(resolution)
        segment_iter, info = model.transcribe(
            str(wav), beam_size=resolution['beamSize'], word_timestamps=True,
            vad_filter=True, vad_parameters={'min_silence_duration_ms': 500},
            condition_on_previous_text=True,
        )
        segments, words, texts = [], [], []
        for idx, seg in enumerate(segment_iter):
            seg_words = []
            for w in (seg.words or []):
                token = (w.word or '').strip()
                if not token:
                    continue
                item = {'word': token, 'start': round(float(w.start), 3), 'end': round(float(w.end), 3),
                        'probability': round(float(w.probability), 6) if w.probability is not None else None}
                seg_words.append(item); words.append(item)
            text = (seg.text or '').strip()
            if text: texts.append(text)
            segments.append({'id': idx, 'start': round(float(seg.start), 3), 'end': round(float(seg.end), 3),
                             'text': text, 'avg_logprob': float(seg.avg_logprob),
                             'no_speech_prob': float(seg.no_speech_prob), 'compression_ratio': float(seg.compression_ratio),
                             'words': seg_words})
        text = ' '.join(texts).strip()
        probs = [w['probability'] for w in words if w.get('probability') is not None]
        raw_conf = round(mean(probs), 6) if probs else None
        quality = {
            'provider': PROVIDER_NAME, 'backend': 'faster-whisper',
            **resolution, **runtime, 'mode': mode, 'has_content': bool(text),
            'has_timestamps': bool(words), 'timestampSource': 'asr-word-timestamps',
            'alignmentStatus': 'not-run', 'diarizationStatus': 'not-run',
            'normalization': normalization, 'segment_count': len(segments),
            'word_count': len(words), 'char_count': len(text),
            'rawAsrConfidence': raw_conf, 'qaGateStatus': 'calibration-required',
            'language': getattr(info, 'language', None),
            'languageProbability': getattr(info, 'language_probability', None),
            'final_status': 'local-transcribed' if text else 'empty',
        }
        return {
            'text': text, 'words': words, 'segments': segments, 'audio_events': [],
            'quality': quality, 'cached': False,
            'raw': {
                'schema': 'epublisher.transcript.raw.v1',
                'createdAt': datetime.now(timezone.utc).isoformat(),
                'requestedProfile': requested_profile,
                'requestedModel': resolution['requestedModel'],
                'resolvedModel': resolution['resolvedModel'],
                'alignmentStatus': 'not-run', 'diarizationStatus': 'not-run',
                'segments': segments,
            },
        }


def _youtube_video_id(url_text: str):
    parsed = urlparse(url_text)
    if parsed.scheme not in ('http', 'https'):
        return None
    host = parsed.hostname.lower() if parsed.hostname else ''
    if host == 'youtu.be':
        vid = parsed.path.strip('/').split('/')[0]
        return vid if vid else None
    if host in ('youtube.com', 'www.youtube.com', 'm.youtube.com') and parsed.path == '/watch':
        return (parse_qs(parsed.query).get('v') or [None])[0]
    if host in ('youtube.com', 'www.youtube.com', 'm.youtube.com') and parsed.path.startswith('/shorts/'):
        parts = parsed.path.split('/')
        return parts[2] if len(parts) > 2 else None
    return None


def transcribe_youtube_url(url_text: str, mode: str, profile=None):
    import yt_dlp
    video_id = _youtube_video_id(url_text)
    if not video_id or not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
        raise ValueError('Only direct public YouTube video URLs with a valid video ID are accepted')
    canonical_url = f'https://www.youtube.com/watch?v={video_id}'
    with tempfile.TemporaryDirectory(prefix='rons-youtube-stt-') as td:
        output = str(Path(td) / '%(id)s.%(ext)s')
        base_options = {
            'noplaylist': True, 'js_runtimes': {YTDLP_JS_RUNTIME: {}}, 'socket_timeout': 15,
            'retries': 2, 'fragment_retries': 2, 'max_filesize': 220 * 1024 * 1024,
            'match_filter': yt_dlp.utils.match_filter_func(f'duration <= {YOUTUBE_MAX_DURATION}'),
            'outtmpl': output, 'quiet': True, 'no_warnings': True,
        }
        acquisition_error = None
        for format_selector in ('bestaudio/best', '140/139/234/233/bestaudio/best'):
            options = {**base_options, 'format': format_selector}
            try:
                with yt_dlp.YoutubeDL(options) as ydl:
                    ydl.extract_info(canonical_url, download=True)
                acquisition_error = None
                break
            except yt_dlp.utils.DownloadError as exc:
                acquisition_error = exc
                for partial in Path(td).iterdir():
                    if partial.is_file():
                        partial.unlink(missing_ok=True)
        if acquisition_error is not None:
            detail = str(acquisition_error).strip().splitlines()[-1][:500]
            low = detail.lower()
            if any(x in low for x in ('video unavailable', 'private video', 'members-only', 'sign in to confirm', 'not available')):
                raise SourceAcquisitionError(422, 'source_unavailable', detail, False) from acquisition_error
            raise SourceAcquisitionError(502, 'upstream_acquisition_failed', detail, True) from acquisition_error
        candidates = [p for p in Path(td).iterdir() if p.is_file() and p.suffix not in ('.part', '.ytdl')]
        if not candidates:
            raise SourceAcquisitionError(502, 'upstream_empty_response', 'YouTube audio acquisition produced no media file', True)
        media = max(candidates, key=lambda p: p.stat().st_size)
        result = transcribe(media.read_bytes(), media.suffix.lower() or '.bin', mode, profile)
        transcript = (result.get('text') or '').strip()
        result.update({'source_url': canonical_url, 'video_id': video_id, 'transcript_type': 'speech_to_text',
                       'acquisition': 'yt-dlp-public-audio', 'retrieved_at': datetime.now(timezone.utc).isoformat(),
                       'content_hash': hashlib.sha256(transcript.encode('utf-8')).hexdigest() if transcript else None})
        result['quality'].update({'source_kind': 'youtube-video', 'evidence_status': 'stt-extracted-not-fact-verified'})
        return result


class Handler(BaseHTTPRequestHandler):
    server_version = 'RONSLocalSTT/0.2'

    def _origin(self):
        return self.headers.get('Origin', '')

    def _cors(self):
        origin = self._origin()
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type,X-Filename,X-Mode,X-Profile')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')

    def _json(self, status, payload, headers=None):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status); self._cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        for key, value in (headers or {}).items(): self.send_header(key, str(value))
        self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        if self.path in ('/health', '/health/stt'):
            self._json(200, health_payload())
        elif self.path == '/health/ready':
            payload = health_payload()
            self._json(200 if payload.get('ok') else 503, payload)
        else:
            self._json(404, {'error': 'not found'})

    def do_POST(self):
        if self.path not in ('/transcribe', '/transcribe-url'):
            self._json(404, {'error': 'not found'}); return
        origin = self._origin()
        if origin not in ALLOWED_ORIGINS and (origin or REQUIRE_ORIGIN):
            self._json(403, {'error': 'origin denied'}); return
        try:
            if not _backend_info().get('available'):
                self._json(503, {'error': 'faster-whisper backend is unavailable'}); return
            size = int(self.headers.get('Content-Length', '0'))
            mode = self.headers.get('X-Mode', 'best').lower()
            profile = self.headers.get('X-Profile', '').lower() or None
            if mode not in MODE_TO_PROFILE: mode = 'best'
            if profile not in PROFILE_SPECS: profile = None
            if self.path == '/transcribe-url':
                if size <= 0 or size > 65536: raise ValueError('invalid URL request size')
                payload = json.loads(self.rfile.read(size).decode('utf-8'))
                url_text = str(payload.get('url') or '').strip()
                mode = str(payload.get('mode') or mode).lower()
                profile = str(payload.get('profile') or profile or '').lower() or None
                if not _STT_GATE.acquire(blocking=False):
                    self._json(503, {'error': 'stt_service_busy', 'retryable': True, 'max_active': MAX_ACTIVE_STT}, {'Retry-After': '2'}); return
                try: self._json(200, transcribe_youtube_url(url_text, mode, profile))
                finally: _STT_GATE.release()
                return
            if size <= 0 or size > 220 * 1024 * 1024: raise ValueError('invalid audio payload size')
            raw = self.rfile.read(size)
            name = self.headers.get('X-Filename', 'audio.wav')
            suffix = Path(name).suffix.lower() or '.wav'
            if not _STT_GATE.acquire(blocking=False):
                self._json(503, {'error': 'stt_service_busy', 'retryable': True, 'max_active': MAX_ACTIVE_STT}, {'Retry-After': '2'}); return
            try: self._json(200, transcribe(raw, suffix, mode, profile))
            finally: _STT_GATE.release()
        except SourceAcquisitionError as exc:
            self._json(exc.status, {'error': exc.code, 'reason': exc.reason, 'retryable': exc.retryable, 'provider': PROVIDER_NAME})
        except ValueError as exc:
            self._json(422, {'error': 'invalid_source_request', 'reason': str(exc), 'retryable': False, 'provider': PROVIDER_NAME})
        except Exception as exc:
            traceback.print_exc()
            self._json(500, {'error': 'transcription_failed', 'reason': str(exc), 'retryable': False, 'provider': PROVIDER_NAME})

    def log_message(self, fmt, *args):
        print('[RONS-STT]', self.address_string(), fmt % args, flush=True)


class RonsThreadingHTTPServer(ThreadingHTTPServer):
    request_queue_size = int(os.environ.get('RONS_STT_LISTEN_BACKLOG', '128'))
    daemon_threads = True


if __name__ == '__main__':
    health = health_payload()
    print(f"[RONS-STT] {HOST}:{PORT} service={SERVICE_NAME} backend={health['backend']} model={health['defaultResolvedModel']}", flush=True)
    RonsThreadingHTTPServer((HOST, PORT), Handler).serve_forever()