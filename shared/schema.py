import pyarrow as pa


METADATA_SCHEMA = pa.schema([
    pa.field("id",                  pa.string(),                    metadata={"encoding": "DELTA_BYTE_ARRAY"}),
    pa.field("duration_sec",        pa.float32()),
    pa.field("snr_db",              pa.float32()),
    pa.field("transcript",          pa.large_string(),               metadata={"compression": "ZSTD"}),
    pa.field("language",            pa.dictionary(pa.int8(), pa.string()), metadata={"encoding": "RLE_DICTIONARY"}),
    pa.field("whisper_confidence",  pa.float32()),
    pa.field("domain",              pa.dictionary(pa.int8(), pa.string()), metadata={"encoding": "RLE_DICTIONARY"}),
    pa.field("sample_for_ce",       pa.bool_(),                     metadata={"encoding": "RLE"}),
    pa.field("sample_for_tts_train", pa.bool_(),                    metadata={"encoding": "RLE"}),
    pa.field("speaker_id",          pa.string()),
    pa.field("channel_id",          pa.string()),
    pa.field("video_id",            pa.string()),
    pa.field("snr_label",           pa.dictionary(pa.int8(), pa.string())),
    pa.field("contains_code_switch", pa.bool_()),
    pa.field("urdu_char_fraction",  pa.float32()),
    pa.field("demucs_applied",      pa.bool_()),
    pa.field("split",               pa.dictionary(pa.int8(), pa.string())),
])

INTENT_LABEL_SCHEMA = pa.schema([
    pa.field("id",                  pa.string()),
    pa.field("domain",              pa.dictionary(pa.int8(), pa.string())),
    pa.field("intent_class",        pa.string()),
    pa.field("sentiment",           pa.dictionary(pa.int8(), pa.string())),
    pa.field("requires_tool",       pa.bool_()),
    pa.field("suggested_tool",      pa.string()),
    pa.field("labeling_confidence", pa.float32()),
    pa.field("labeling_source",     pa.string()),
    pa.field("transcript",          pa.large_string()),
    pa.field("contains_code_switch", pa.bool_()),
    pa.field("split",               pa.dictionary(pa.int8(), pa.string())),
])

SAMPLE_RATES: dict[tuple[str, str, str], float] = {
    ("snr_pass", "ur",              "conf_high"):     0.020,
    ("snr_pass", "ur+en",           "code_switch"):   0.050,
    ("snr_flag", "ur",              "conf_med"):      0.030,
    ("snr_pass", "ur",              "short"):         0.010,
    ("domain",   "banking_health_edu", ""):           0.100,
}

TTS_TRAIN_FILTERS = {
    "min_snr_db":        20.0,
    "min_whisper_conf":  0.88,
    "min_duration_sec":  2.0,
    "max_duration_sec":  8.0,
    "max_segs_per_speaker": 50,
    "target_hours":      190.0,
}
