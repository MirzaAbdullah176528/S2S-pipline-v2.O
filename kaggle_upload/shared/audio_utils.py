import re
import subprocess
import time
from pathlib import Path

import numpy as np


TARGET_SR         = 24000
TARGET_LUFS       = -23.0
MIN_SEG_SEC       = 3.0
MAX_SEG_SEC       = 15.0
SNR_PASS          = 20.0
SNR_FLAG          = 15.0
WHISPER_CONF_PASS = 0.75
URDU_CHARS        = set("ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوہھیئاآءۃے")

try:
    from urdu_s2s_core import fast_snr_filter
    RUST_AVAILABLE = True
except ImportError:
    RUST_AVAILABLE = False


def compute_snr(audio_array: np.ndarray, frame_length: int = 2048, noise_percentile: int = 10) -> float:
    if len(audio_array) < frame_length:
        return 0.0
    hop    = frame_length // 2
    frames = np.lib.stride_tricks.sliding_window_view(audio_array, frame_length)[::hop]
    energies = np.mean(frames ** 2, axis=1)
    energies = energies[energies > 0]
    if len(energies) == 0:
        return 0.0
    noise_floor = np.percentile(energies, noise_percentile)
    if noise_floor <= 0:
        return 60.0
    return float(10 * np.log10(np.mean(energies) / noise_floor))


def compute_snr_batch(audio_arrays: list[np.ndarray]) -> list[float]:
    if RUST_AVAILABLE:
        return fast_snr_filter(audio_arrays)
    return [compute_snr(a) for a in audio_arrays]


def standardize_audio(input_path, output_path) -> Path:
    input_path  = Path(input_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    result = subprocess.run(
        ["ffmpeg", "-y", "-i", str(input_path),
         "-ar", str(TARGET_SR), "-ac", "1", "-sample_fmt", "s16", "-vn",
         str(output_path)],
        capture_output=True, timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr.decode()[-300:]}")
    return output_path


def normalize_loudness(audio_array: np.ndarray, sr: int = TARGET_SR) -> np.ndarray | None:
    import pyloudnorm as pyln
    audio_f64 = audio_array.astype(np.float64)
    meter     = pyln.Meter(sr)
    loudness  = meter.integrated_loudness(audio_f64)
    if not np.isfinite(loudness):
        return None
    normalized = pyln.normalize.loudness(audio_f64, loudness, TARGET_LUFS)
    if np.max(np.abs(normalized)) > 1.0:
        return None
    return normalized.astype(np.float32)


def load_audio_chunk(audio_path, start_sample: int, chunk_samples: int, sr: int = TARGET_SR) -> np.ndarray:
    import soundfile as sf
    with sf.SoundFile(audio_path) as f:
        if f.samplerate != sr:
            raise ValueError(f"Expected {sr}Hz got {f.samplerate}Hz")
        f.seek(start_sample)
        return f.read(chunk_samples, dtype="float32")


def iter_audio_chunks(audio_path, chunk_minutes: int = 10, sr: int = TARGET_SR):
    import soundfile as sf
    chunk_samples = chunk_minutes * 60 * sr
    with sf.SoundFile(audio_path) as f:
        total_samples = len(f)
        if f.samplerate != sr:
            raise ValueError(f"Expected {sr}Hz got {f.samplerate}Hz")
    offset = 0
    while offset < total_samples:
        chunk = load_audio_chunk(audio_path, offset, chunk_samples, sr)
        if len(chunk) == 0:
            break
        yield offset, chunk
        offset += chunk_samples


def run_vad(audio_array: np.ndarray, sr: int = TARGET_SR) -> list[dict]:
    import torch
    vad_model, utils = torch.hub.load(
        repo_or_dir="snakers4/silero-vad", model="silero_vad",
        force_reload=False, onnx=False, verbose=False,
    )
    get_ts = utils[0]
    tensor = torch.FloatTensor(audio_array)
    raw    = get_ts(tensor, vad_model, sampling_rate=sr)

    segments = []
    for ts in raw:
        start = ts["start"] / sr
        end   = ts["end"]   / sr
        dur   = end - start
        if dur < MIN_SEG_SEC:
            continue
        if dur <= MAX_SEG_SEC:
            segments.append({"start": start, "end": end, "duration": round(dur, 3)})
            continue
        cursor = start
        while cursor < end:
            seg_end = min(cursor + MAX_SEG_SEC, end)
            seg_dur = seg_end - cursor
            if seg_dur >= MIN_SEG_SEC:
                segments.append({"start": cursor, "end": seg_end, "duration": round(seg_dur, 3)})
            cursor += MAX_SEG_SEC
    return segments


def extract_segment_array(audio_array: np.ndarray, sr: int, start_sec: float, end_sec: float) -> np.ndarray:
    return audio_array[int(start_sec * sr):int(end_sec * sr)]


def apply_demucs(input_path, output_path, device: str = "cuda") -> Path:
    input_path = Path(input_path)
    out_dir    = Path(output_path).parent
    out_dir.mkdir(parents=True, exist_ok=True)

    result = subprocess.run(
        ["python", "-m", "demucs.separate", "--two-stems", "vocals",
         "--name", "htdemucs", "--device", device,
         "--out", str(out_dir / "demucs_out"), str(input_path)],
        capture_output=True, timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(f"demucs failed: {result.stderr.decode()[-300:]}")

    vocals_path = out_dir / "demucs_out" / "htdemucs" / input_path.stem / "vocals.wav"
    if not vocals_path.exists():
        raise FileNotFoundError(f"demucs vocals not found at {vocals_path}")

    standardize_audio(vocals_path, output_path)
    return Path(output_path)


_whisper_model_cache: dict = {}


def get_whisper_model(model_size: str = "tiny", device: str = "cpu"):
    key = (model_size, device)
    if key not in _whisper_model_cache:
        from faster_whisper import WhisperModel
        compute = "float16" if device == "cuda" else "int8"
        _whisper_model_cache[key] = WhisperModel(model_size, device=device, compute_type=compute)
    return _whisper_model_cache[key]


def detect_language(audio_path, model_size: str = "tiny", device: str = "cpu") -> tuple[str, float]:
    model    = get_whisper_model(model_size, device)
    _, info  = model.transcribe(str(audio_path), language=None, task="transcribe", beam_size=1)
    lang     = info.language
    lang_prob = round(info.language_probability, 3)
    if lang == "hi" and lang_prob < 0.85:
        lang = "ur"
    return lang, lang_prob


def transcribe_segment(audio_path, model_size: str = "large-v3", device: str = "cuda") -> dict | None:
    model = get_whisper_model(model_size, device)
    raw_segments, info = model.transcribe(
        str(audio_path), language="ur", task="transcribe",
        beam_size=5, word_timestamps=True, vad_filter=False,
    )
    segments_list = list(raw_segments)
    full_text     = " ".join(s.text.strip() for s in segments_list).strip()

    word_timestamps: list[dict] = []
    all_probs: list[float]      = []
    for seg in segments_list:
        if seg.words:
            for w in seg.words:
                word_timestamps.append({
                    "word": w.word.strip(), "start": round(w.start, 3),
                    "end": round(w.end, 3), "probability": round(w.probability, 3),
                })
                all_probs.append(w.probability)

    avg_confidence = round(float(np.mean(all_probs)), 3) if all_probs else 0.0
    english_words  = list(set(w.lower() for w in re.findall(r'\b[a-zA-Z]{2,}\b', full_text)))

    urdu_char_fraction = sum(1 for c in full_text if c in URDU_CHARS) / max(len(full_text), 1)
    if urdu_char_fraction > 0.3:
        lang = "ur"
    else:
        lang = info.language

    has_urdu = any(c in URDU_CHARS for c in full_text)
    if not has_urdu and not english_words:
        return None

    return {
        "transcript":           full_text,
        "language":             lang,
        "language_probability": round(info.language_probability, 3),
        "avg_confidence":       avg_confidence,
        "word_timestamps":      word_timestamps,
        "contains_code_switch": len(english_words) > 0,
        "english_words":        english_words,
        "urdu_char_fraction":   round(urdu_char_fraction, 3),
    }


def save_segment_wav(audio_array: np.ndarray, output_path, sr: int = TARGET_SR) -> Path:
    import soundfile as sf
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_path), audio_array, sr, subtype="PCM_16")
    return output_path


def get_audio_duration(audio_path) -> float:
    import soundfile as sf
    with sf.SoundFile(audio_path) as f:
        return len(f) / f.samplerate


def snr_label(snr_db: float) -> str:
    if snr_db >= SNR_PASS:
        return "pass"
    if snr_db >= SNR_FLAG:
        return "flag"
    return "reject"


BUCKET_SIZES = [64, 128, 256, 512, 1024]


def quantize_to_bucket(length: int) -> int:
    for b in BUCKET_SIZES:
        if length <= b:
            return b
    return BUCKET_SIZES[-1]
