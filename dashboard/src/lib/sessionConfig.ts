export interface RuntimeDevice {
  id: string;
  label: string;
  accelerator: string;       // exact string for Kaggle API --accelerator flag
  kaggleApiValue: "cpu" | "gpu" | "tpu";
  enableGpu: boolean;
  enableTpu: boolean;
  description: string;
  vramGB: number | null;     // GPU VRAM, null for CPU/TPU
}

export const RUNTIME_DEVICES: RuntimeDevice[] = [
  {
    id: "cpu",
    label: "CPU (No Accelerator)",
    accelerator: "cpu",
    kaggleApiValue: "cpu",
    enableGpu: false,
    enableTpu: false,
    description: "Standard CPU runtime — no accelerator. Best for data collection, labeling, and I/O-bound stages.",
    vramGB: null,
  },
  {
    id: "gpu_t4",
    label: "GPU T4 (16 GB VRAM)",
    accelerator: "NvidiaTeslaT4",
    kaggleApiValue: "gpu",
    enableGpu: true,
    enableTpu: false,
    description: "NVIDIA T4 with 16 GB VRAM. Suitable for audio cleaning (Demucs) and light encoding tasks.",
    vramGB: 16,
  },
  {
    id: "gpu_t4_highmem",
    label: "GPU T4 High-Mem (16 GB VRAM)",
    accelerator: "NvidiaTeslaT4Highmem",
    kaggleApiValue: "gpu",
    enableGpu: true,
    enableTpu: false,
    description: "NVIDIA T4 with extended memory. Useful when standard T4 runs out of host RAM.",
    vramGB: 16,
  },
  {
    id: "gpu_p100",
    label: "GPU P100 (16 GB VRAM)",
    accelerator: "NvidiaTeslaP100",
    kaggleApiValue: "gpu",
    enableGpu: true,
    enableTpu: false,
    description: "NVIDIA P100 with 16 GB VRAM. Good for Whisper encoding and heavier GPU inference workloads.",
    vramGB: 16,
  },
  {
    id: "gpu_l4",
    label: "GPU L4 (24 GB VRAM)",
    accelerator: "NvidiaL4",
    kaggleApiValue: "gpu",
    enableGpu: true,
    enableTpu: false,
    description: "NVIDIA L4 with 24 GB VRAM. Modern Ampere architecture — efficient for inference and moderate training.",
    vramGB: 24,
  },
  {
    id: "gpu_a100",
    label: "GPU A100 (40 GB VRAM)",
    accelerator: "NvidiaTeslaA100",
    kaggleApiValue: "gpu",
    enableGpu: true,
    enableTpu: false,
    description: "NVIDIA A100 with 40 GB VRAM. High-end GPU for large models and fast training. May require competition access.",
    vramGB: 40,
  },
  {
    id: "tpu_vm_v3",
    label: "TPU VM v3-8",
    accelerator: "Tpu1VmV38",
    kaggleApiValue: "tpu",
    enableGpu: false,
    enableTpu: true,
    description: "Google TPU VM v3-8 (8 cores). VM-based replacement for legacy TPU v3-8. Good for fine-tuning and synthesis.",
    vramGB: null,
  },
  {
    id: "tpu_v5e",
    label: "TPU v5e-8",
    accelerator: "TpuV5E8",
    kaggleApiValue: "tpu",
    enableGpu: false,
    enableTpu: true,
    description: "Google TPU v5e-8. Current default TPU on Kaggle — up to 2x training and 2.5x inference speed vs v3-8. Purpose-built for generative AI.",
    vramGB: null,
  },
];

// ── Kaggle Accounts ───────────────────────────────────────────────────────────

export interface KaggleAccount {
  id: string;
  label: string;
  username: string;         // matches KAGGLE_USERNAME_<SUFFIX> env var pattern
  description: string;
}

export const KAGGLE_ACCOUNTS: KaggleAccount[] = [
  {
    id: "primary",
    label: "Primary — mirza176528",
    username: "mirza176528",
    description: "Main pipeline account — used for standard session launches. Most datasets and kernels are owned by this account.",
  },
  {
    id: "secondary",
    label: "Secondary — mirza176528-alt",
    username: "mirza176528-alt",
    description: "Backup account for parallel session execution when the primary account has reached its Kaggle kernel quota or concurrent run limit.",
  },
];

// ── Hugging Face Repositories ─────────────────────────────────────────────────
// Mirrors kaggle_upload/config/hf_repos.yaml — all repos use MessAgentix org.

export interface HfRepo {
  id: string;                // config key from hf_repos.yaml
  repoId: string;            // org/repo on Hugging Face
  token: "PRIMARY" | "SECONDARY" | "TERTIARY";
  description: string;
  subdirs: string[];
  recommendedFor: string[];  // session types that typically write to this repo
}

export const HF_REPOS: HfRepo[] = [
  {
    id: "stage0_codec",
    repoId: "MessAgentix/stage0-codec",
    token: "PRIMARY",
    description: "Raw WAV 24kHz/16-bit + metadata Parquet shards (~345 GB at 10Kh)",
    subdirs: ["audio/", "metadata/"],
    recommendedFor: ["cpu_collect", "cpu_clean"],
  },
  {
    id: "overflow",
    repoId: "MessAgentix/overflow-stage0",
    token: "TERTIARY",
    description: "Stage0 overflow when PRIMARY repo exceeds 250GB local counter (~50-100 GB)",
    subdirs: ["audio/", "metadata/"],
    recommendedFor: ["cpu_collect"],
  },
  {
    id: "stage1_ce",
    repoId: "MessAgentix/stage1-ce",
    token: "PRIMARY",
    description: "Mimi codec tokens (.npy per segment) + intent labels Parquet (~140 GB)",
    subdirs: ["tokens/", "labels/"],
    recommendedFor: ["gpu_encode", "cpu_label"],
  },
  {
    id: "stage2_moe",
    repoId: "MessAgentix/stage2-moe",
    token: "SECONDARY",
    description: "Seed dialogues + augmented variants JSONL (~800 MB)",
    subdirs: ["seeds/", "augmented/"],
    recommendedFor: ["cpu_label", "cpu_dialogue"],
  },
  {
    id: "stage3_agent",
    repoId: "MessAgentix/stage3-agent",
    token: "SECONDARY",
    description: "Agent episode JSONL (~1.2 GB)",
    subdirs: ["episodes/", "dummy_env/", "tools/"],
    recommendedFor: ["cpu_episodes", "tpu_synth"],
  },
  {
    id: "stage45_e2e",
    repoId: "MessAgentix/stage45-e2e",
    token: "SECONDARY",
    description: "Aligned WAV/text pairs + MMS-TTS checkpoint in checkpoints/ subfolder (~50 GB)",
    subdirs: ["audio/", "aligned/", "checkpoints/"],
    recommendedFor: ["tpu_finetune", "tpu_synth"],
  },
  {
    id: "domain_restaurant",
    repoId: "MessAgentix/domain-restaurant",
    token: "SECONDARY",
    description: "Restaurant domain episodes and synthesis",
    subdirs: [],
    recommendedFor: ["cpu_episodes", "tpu_synth"],
  },
  {
    id: "domain_banking",
    repoId: "MessAgentix/domain-banking",
    token: "SECONDARY",
    description: "Banking domain episodes and synthesis",
    subdirs: [],
    recommendedFor: ["cpu_episodes", "tpu_synth"],
  },
  {
    id: "domain_healthcare",
    repoId: "MessAgentix/domain-healthcare",
    token: "SECONDARY",
    description: "Healthcare domain episodes and synthesis",
    subdirs: [],
    recommendedFor: ["cpu_episodes", "tpu_synth"],
  },
  {
    id: "domain_education",
    repoId: "MessAgentix/domain-education",
    token: "SECONDARY",
    description: "Education domain episodes and synthesis",
    subdirs: [],
    recommendedFor: ["cpu_episodes", "tpu_synth"],
  },
];

// ── Session Definitions ───────────────────────────────────────────────────────

export interface SessionRequirement {
  category: "api" | "env" | "data" | "resource" | "config";
  label: string;
  description: string;
  required: boolean;          // if true, session cannot launch without this met
  detail?: string;            // extra context
}

export interface SessionConfig {
  id: string;                 // matches session_type in the worker DB
  label: string;              // human-readable name
  notebookFile: string;       // notebook filename in the Kaggle dataset
  stages: string[];           // pipeline stages this session runs (e.g. ["p1a", "p1b", "p1e"])
  stageLabel: string;         // short pipeline stage badge (e.g. "P1: Collect")
  description: string;        // what this session does
  compatibleDevices: string[];// runtime device IDs this session can use
  recommendedDevice: string;  // recommended device for best performance
  outputHfRepos: string[];    // HF repo IDs this session writes to
  inputHfRepos: string[];     // HF repo IDs this session reads from (prerequisites)
  requirements: SessionRequirement[];
  sessionMaxHours: number;    // max Kaggle session duration
  enableInternet: boolean;    // whether kernel needs internet access
  estimatedDiskGb: number;    // estimated disk usage
  estimatedRamGb: number;     // estimated RAM needed
}

export const SESSIONS: SessionConfig[] = [
  {
    id: "cpu_collect",
    label: "Data Collection (CPU)",
    notebookFile: "session_cpu_collect.ipynb",
    stages: ["p1a", "p1b", "p1e"],
    stageLabel: "P1: Collect",
    description:
      "Discovers YouTube sources, downloads raw audio, validates SNR, and uploads WAV shards + metadata to the stage0-codec Hugging Face repository. This is the data ingestion entry point for the entire pipeline.",
    compatibleDevices: ["cpu"],
    recommendedDevice: "cpu",
    outputHfRepos: ["stage0_codec", "overflow"],
    inputHfRepos: [],
    requirements: [
      { category: "api", label: "YouTube Data API", description: "Used by p1a to discover and list candidate video URLs for download.", required: true, detail: "Quota: 10,000 units/day. Ensure the API key has YouTube Data API v3 enabled." },
      { category: "api", label: "Kaggle Internet Access", description: "Kernel must have internet enabled to reach YouTube and Hugging Face endpoints.", required: true },
      { category: "env", label: "HF_TOKEN_PRIMARY", description: "Hugging Face write token for the MessAgentix/stage0-codec repository.", required: true },
      { category: "env", label: "HF_TOKEN_TERTIARY", description: "Fallback Hugging Face token for overflow repository when primary exceeds 250 GB.", required: true },
      { category: "env", label: "CF_WORKER_URL", description: "Cloudflare Worker URL for heartbeat and queue coordination.", required: true },
      { category: "env", label: "CF_WORKER_SECRET", description: "Authentication secret for the Cloudflare Worker API.", required: true },
      { category: "data", label: "No prior data required", description: "This is the first pipeline stage — it discovers and downloads raw data from scratch.", required: true, detail: "However, a query bank (query_bank.yaml) must exist in the config/ directory of the dataset." },
      { category: "resource", label: "Disk Space: ~20 GB", description: "Temporary storage for downloaded audio before upload to HF. Kaggle provides ~20 GB working disk.", required: true },
      { category: "resource", label: "RAM: ~4 GB", description: "Minimal RAM needed — mostly I/O-bound with light audio processing (SNR estimation).", required: false },
      { category: "config", label: "Kaggle Secrets Configured", description: "All required secrets must be added to the Kaggle kernel's custom secrets before launch.", required: true },
    ],
    sessionMaxHours: 9,
    enableInternet: true,
    estimatedDiskGb: 20,
    estimatedRamGb: 4,
  },
  {
    id: "cpu_clean",
    label: "Audio Cleaning & Segmentation (CPU)",
    notebookFile: "session_cpu_clean.ipynb",
    stages: ["p1c"],
    stageLabel: "P1c: Clean (CPU)",
    description:
      "Runs VAD-based speech segmentation, SNR filtering, loudness normalization, and language detection on downloaded audio. Produces clean 3-15 second speech segments ready for GPU Demucs cleaning or direct encoding. Flagged low-SNR segments are separated for potential GPU source separation.",
    compatibleDevices: ["cpu"],
    recommendedDevice: "cpu",
    outputHfRepos: ["stage0_codec"],
    inputHfRepos: ["stage0_codec"],
    requirements: [
      { category: "api", label: "Kaggle Internet Access", description: "Kernel needs internet to download Silero VAD model and Faster-Whisper weights, and upload segments to Hugging Face.", required: true },
      { category: "env", label: "HF_TOKEN_PRIMARY", description: "Hugging Face write token for MessAgentix/stage0-codec (segments output).", required: true },
      { category: "env", label: "CF_WORKER_URL", description: "Cloudflare Worker URL for heartbeat and queue coordination.", required: true },
      { category: "env", label: "CF_WORKER_SECRET", description: "Authentication secret for the Cloudflare Worker API.", required: true },
      { category: "data", label: "stage0_codec standardized audio", description: "Standardized WAV files from cpu_collect (p1b) must exist in MessAgentix/stage0-codec.", required: true, detail: "Run cpu_collect first to download and standardize raw audio." },
      { category: "resource", label: "Disk Space: ~20 GB", description: "Temporary storage for audio download, VAD segments, and flagged output before upload.", required: true },
      { category: "resource", label: "RAM: ~8 GB", description: "Faster-Whisper tiny model + Silero VAD + audio processing. More RAM helps with long audio files.", required: false },
      { category: "config", label: "VAD & Whisper Auto-Download", description: "Silero VAD and Faster-Whisper tiny model are auto-downloaded on first run. Ensure internet access is enabled.", required: true },
    ],
    sessionMaxHours: 9,
    enableInternet: true,
    estimatedDiskGb: 20,
    estimatedRamGb: 8,
  },
  {
    id: "cpu_label",
    label: "Data Labeling (CPU)",
    notebookFile: "session_cpu_label.ipynb",
    stages: ["p2a"],
    stageLabel: "P2a: Label",
    description:
      "Labels intent classes for collected transcripts using the Gemini API. Reads raw metadata from stage0-codec and produces labeled datasets for the MoE dialogue generation stage. Also generates seed dialogues for stage2-moe.",
    compatibleDevices: ["cpu"],
    recommendedDevice: "cpu",
    outputHfRepos: ["stage2_moe", "stage1_ce"],
    inputHfRepos: ["stage0_codec", "stage1_ce"],
    requirements: [
      { category: "api", label: "Gemini API (at least 1 key)", description: "Used by p2a to generate intent labels and seed dialogues. Supports key rotation across GEMINI_API_KEY_01 through _04.", required: true, detail: "At least one key must be provided. Multiple keys enable rotation and higher throughput." },
      { category: "api", label: "Kaggle Internet Access", description: "Kernel needs internet to reach Gemini API and Hugging Face endpoints.", required: true },
      { category: "env", label: "HF_TOKEN_PRIMARY", description: "Hugging Face write token for MessAgentix/stage1-ce (labels output).", required: true },
      { category: "env", label: "HF_TOKEN_SECONDARY", description: "Hugging Face write token for MessAgentix/stage2-moe (seed dialogues output).", required: true },
      { category: "env", label: "CF_WORKER_URL", description: "Cloudflare Worker URL for heartbeat and queue coordination.", required: true },
      { category: "env", label: "CF_WORKER_SECRET", description: "Authentication secret for the Cloudflare Worker API.", required: true },
      { category: "env", label: "GEMINI_API_KEY_01 (or 02/03/04)", description: "At least one Gemini API key for labeling requests. More keys allow higher QPS via rotation.", required: true },
      { category: "data", label: "stage0_codec metadata", description: "Transcript metadata Parquet from the cpu_collect session must exist in MessAgentix/stage0-codec.", required: true, detail: "Download p1e output from HF before running this session." },
      { category: "data", label: "stage1-ce tokens (if re-labeling)", description: "If running re-labeling on already-encoded data, the token files must exist in MessAgentix/stage1-ce.", required: false },
      { category: "resource", label: "Disk Space: ~5 GB", description: "Temporary storage for metadata Parquet and generated label files.", required: true },
      { category: "resource", label: "RAM: ~4 GB", description: "Light processing — mostly API calls and JSON/Parquet I/O.", required: false },
      { category: "config", label: "Intent Taxonomy (intent_taxonomy.yaml)", description: "The intent taxonomy config must exist in the dataset for labeling guidance.", required: true },
    ],
    sessionMaxHours: 9,
    enableInternet: true,
    estimatedDiskGb: 5,
    estimatedRamGb: 4,
  },
  {
    id: "gpu_clean",
    label: "Data Cleaning (GPU)",
    notebookFile: "session_gpu_clean.ipynb",
    stages: ["p1d"],
    stageLabel: "P1d: Clean (GPU)",
    description:
      "Runs Demucs source separation on downloaded audio to isolate speech from background noise. Requires a GPU (T4 or better) for real-time inference. Outputs cleaned audio segments back to the stage0-codec repository.",
    compatibleDevices: ["gpu_t4", "gpu_t4_highmem", "gpu_p100", "gpu_l4", "gpu_a100"],
    recommendedDevice: "gpu_t4",
    outputHfRepos: ["stage0_codec"],
    inputHfRepos: ["stage0_codec"],
    requirements: [
      { category: "api", label: "Kaggle Internet Access", description: "Kernel needs internet to download Demucs model weights and upload to Hugging Face.", required: true },
      { category: "env", label: "HF_TOKEN_PRIMARY", description: "Hugging Face write token for MessAgentix/stage0-codec repository.", required: true },
      { category: "env", label: "CF_WORKER_URL", description: "Cloudflare Worker URL for heartbeat and queue coordination.", required: true },
      { category: "env", label: "CF_WORKER_SECRET", description: "Authentication secret for the Cloudflare Worker API.", required: true },
      { category: "data", label: "stage0_codec raw audio", description: "Raw WAV files from cpu_collect must exist in MessAgentix/stage0-codec before cleaning can proceed.", required: true, detail: "Run cpu_collect (p1a/p1b/p1e) first to populate this repository." },
      { category: "resource", label: "GPU: NVIDIA T4 or better (16 GB VRAM)", description: "Demucs requires CUDA. T4 (16 GB) is the minimum; L4 or A100 recommended for faster processing.", required: true },
      { category: "resource", label: "Disk Space: ~30 GB", description: "Needs space for raw audio download, Demucs model, and cleaned output before upload.", required: true },
      { category: "resource", label: "VRAM: ~8 GB peak", description: "Demucs htdemucs model uses ~6-8 GB VRAM during inference. Batch processing managed by workflow kernel watchdog.", required: true },
      { category: "config", label: "Demucs Model Available", description: "The htdemucs model will be auto-downloaded on first run. Ensure internet access is enabled.", required: true },
    ],
    sessionMaxHours: 9,
    enableInternet: true,
    estimatedDiskGb: 30,
    estimatedRamGb: 16,
  },
  {
    id: "gpu_encode",
    label: "Data Encoding (GPU)",
    notebookFile: "session_gpu_encode.ipynb",
    stages: ["p2b"],
    stageLabel: "P2b: Encode",
    description:
      "Encodes audio segments into Mimi codec tokens using the Kyutai Moshi tokenizer. Also runs Whisper for transcription confidence scoring. Requires a GPU for real-time codec encoding and transcription.",
    compatibleDevices: ["gpu_p100", "gpu_t4", "gpu_t4_highmem", "gpu_l4", "gpu_a100"],
    recommendedDevice: "gpu_p100",
    outputHfRepos: ["stage1_ce"],
    inputHfRepos: ["stage0_codec"],
    requirements: [
      { category: "api", label: "Kaggle Internet Access", description: "Kernel needs internet to download Mimi model weights and upload encoded tokens to Hugging Face.", required: true },
      { category: "env", label: "HF_TOKEN_PRIMARY", description: "Hugging Face write token for MessAgentix/stage1-ce (codec tokens + labels output).", required: true },
      { category: "env", label: "CF_WORKER_URL", description: "Cloudflare Worker URL for heartbeat and queue coordination.", required: true },
      { category: "env", label: "CF_WORKER_SECRET", description: "Authentication secret for the Cloudflare Worker API.", required: true },
      { category: "data", label: "stage0_codec cleaned audio", description: "Cleaned WAV files must exist in MessAgentix/stage0-codec. Run gpu_clean (p1d) first if audio has not been source-separated.", required: true, detail: "If cpu_collect output is already clean enough (SNR > 20dB), p1d may be skipped." },
      { category: "resource", label: "GPU: NVIDIA P100 or better (16 GB VRAM)", description: "Mimi codec and Whisper both require CUDA. P100 recommended for throughput; T4 also supported.", required: true },
      { category: "resource", label: "Disk Space: ~40 GB", description: "Space for audio download, Mimi model, Whisper model, and .npy token output.", required: true },
      { category: "resource", label: "VRAM: ~10 GB peak", description: "Mimi codec + Whisper running concurrently can use ~8-10 GB VRAM. Watchdog manages memory pressure.", required: true },
      { category: "config", label: "Mimi Model Available", description: "Kyutai Mimi model weights will be auto-downloaded. Ensure internet is enabled and sufficient disk space.", required: true },
    ],
    sessionMaxHours: 9,
    enableInternet: true,
    estimatedDiskGb: 40,
    estimatedRamGb: 16,
  },
  {
    id: "cpu_dialogue",
    label: "Dialogue Generation (CPU)",
    notebookFile: "session_cpu_dialogue.ipynb",
    stages: ["p3a", "p3b", "p3c"],
    stageLabel: "P3: Dialogue",
    description:
      "Generates seed dialogues using the Gemini API based on labeled intent data, augments them with paraphrasing and slot-filling variations, and uploads the augmented dialogue dataset to the stage2-moe Hugging Face repository. These dialogues serve as the training data for the MoE routing model.",
    compatibleDevices: ["cpu"],
    recommendedDevice: "cpu",
    outputHfRepos: ["stage2_moe"],
    inputHfRepos: ["stage1_ce", "stage2_moe"],
    requirements: [
      { category: "api", label: "Gemini API (at least 1 key)", description: "Used by p3a to generate seed dialogues and p3b for augmentation. Supports key rotation across GEMINI_API_KEY_01 through _04.", required: true, detail: "At least one key must be provided. Multiple keys enable rotation and higher throughput." },
      { category: "api", label: "Kaggle Internet Access", description: "Kernel needs internet to reach Gemini API and Hugging Face endpoints.", required: true },
      { category: "env", label: "HF_TOKEN_SECONDARY", description: "Hugging Face write token for MessAgentix/stage2-moe (dialogues output).", required: true },
      { category: "env", label: "CF_WORKER_URL", description: "Cloudflare Worker URL for heartbeat and queue coordination.", required: true },
      { category: "env", label: "CF_WORKER_SECRET", description: "Authentication secret for the Cloudflare Worker API.", required: true },
      { category: "env", label: "GEMINI_API_KEY_01 (or 02/03/04)", description: "At least one Gemini API key for dialogue generation. More keys allow higher QPS via rotation.", required: true },
      { category: "data", label: "stage1-ce labeled data", description: "Intent-labeled data from cpu_label (p2a) must exist in MessAgentix/stage1-ce.", required: true },
      { category: "data", label: "stage2-moe seed dialogues (optional)", description: "If resuming, existing seed dialogues in MessAgentix/stage2-moe will be extended rather than overwritten.", required: false },
      { category: "resource", label: "Disk Space: ~5 GB", description: "Temporary storage for labeled data download and generated dialogue files.", required: true },
      { category: "resource", label: "RAM: ~4 GB", description: "Light processing — mostly API calls and JSON I/O.", required: false },
      { category: "config", label: "Intent Taxonomy (intent_taxonomy.yaml)", description: "The intent taxonomy config must exist in the dataset for dialogue generation guidance.", required: true },
    ],
    sessionMaxHours: 9,
    enableInternet: true,
    estimatedDiskGb: 5,
    estimatedRamGb: 4,
  },
  {
    id: "cpu_episodes",
    label: "Agent Episode Generation (CPU)",
    notebookFile: "session_cpu_episodes.ipynb",
    stages: ["p4a", "p4b", "p4c"],
    stageLabel: "P4: Episodes",
    description:
      "Builds dummy tool environments for agent simulation, generates agent episodes using the Gemini API with tool-calling patterns, and uploads episodes to the stage3-agent Hugging Face repository. Episodes define the conversation flow, tool invocations, and expected responses for each domain scenario.",
    compatibleDevices: ["cpu"],
    recommendedDevice: "cpu",
    outputHfRepos: ["stage3_agent"],
    inputHfRepos: ["stage2_moe", "stage3_agent"],
    requirements: [
      { category: "api", label: "Gemini API (at least 1 key)", description: "Used by p4b to generate agent episodes with tool-calling patterns. Supports key rotation.", required: true, detail: "At least one key must be provided. Multiple keys enable rotation and higher throughput." },
      { category: "api", label: "Kaggle Internet Access", description: "Kernel needs internet to reach Gemini API and Hugging Face endpoints.", required: true },
      { category: "env", label: "HF_TOKEN_SECONDARY", description: "Hugging Face write token for MessAgentix/stage3-agent (episodes output).", required: true },
      { category: "env", label: "CF_WORKER_URL", description: "Cloudflare Worker URL for heartbeat and queue coordination.", required: true },
      { category: "env", label: "CF_WORKER_SECRET", description: "Authentication secret for the Cloudflare Worker API.", required: true },
      { category: "env", label: "GEMINI_API_KEY_01 (or 02/03/04)", description: "At least one Gemini API key for episode generation. More keys allow higher QPS.", required: true },
      { category: "data", label: "stage2-moe dialogue data", description: "Augmented dialogues from cpu_dialogue (p3a/p3b) must exist in MessAgentix/stage2-moe.", required: true },
      { category: "data", label: "stage3-agent existing episodes (optional)", description: "If resuming, existing episodes in MessAgentix/stage3-agent will be extended.", required: false },
      { category: "resource", label: "Disk Space: ~5 GB", description: "Temporary storage for dialogue download and generated episode files.", required: true },
      { category: "resource", label: "RAM: ~4 GB", description: "Light processing — mostly API calls and JSON I/O.", required: false },
      { category: "config", label: "Domain Config Available", description: "Domain-specific tool registry and intent taxonomy configs must be in the dataset.", required: true },
    ],
    sessionMaxHours: 9,
    enableInternet: true,
    estimatedDiskGb: 5,
    estimatedRamGb: 4,
  },
  {
    id: "tpu_finetune",
    label: "Model Fine-tuning (TPU)",
    notebookFile: "session_tpu_finetune.ipynb",
    stages: ["p5_finetune"],
    stageLabel: "P5: Finetune",
    description:
      "Fine-tunes the Moshi S2S model on TPU using the aligned codec tokens and dialogue data produced by earlier pipeline stages. This is the most resource-intensive session and requires TPU or high-end GPU access.",
    compatibleDevices: ["tpu_v5e", "tpu_vm_v3", "gpu_a100", "gpu_l4"],
    recommendedDevice: "tpu_v5e",
    outputHfRepos: ["stage45_e2e"],
    inputHfRepos: ["stage1_ce", "stage2_moe", "stage3_agent", "stage45_e2e"],
    requirements: [
      { category: "api", label: "Kaggle Internet Access", description: "TPU kernel needs internet to download training data from Hugging Face and upload checkpoints.", required: true },
      { category: "env", label: "HF_TOKEN_SECONDARY", description: "Hugging Face write token for MessAgentix/stage45-e2e (checkpoints output).", required: true },
      { category: "env", label: "HF_TOKEN_PRIMARY", description: "Hugging Face read token for downloading training data from stage1-ce and stage2-moe.", required: true },
      { category: "env", label: "CF_WORKER_URL", description: "Cloudflare Worker URL for heartbeat and queue coordination.", required: true },
      { category: "env", label: "CF_WORKER_SECRET", description: "Authentication secret for the Cloudflare Worker API.", required: true },
      { category: "data", label: "stage1-ce codec tokens", description: "Mimi codec token files (.npy) must exist in MessAgentix/stage1-ce. Produced by gpu_encode (p2b).", required: true },
      { category: "data", label: "stage2-moe dialogue data", description: "Seed + augmented dialogues must exist in MessAgentix/stage2-moe. Produced by cpu_label (p2a).", required: true },
      { category: "data", label: "stage3-agent episodes", description: "Agent episode JSONL must exist in MessAgentix/stage3-agent. Produced by pipeline 3/4 stages.", required: true },
      { category: "data", label: "stage45-e2e base checkpoint", description: "A base Moshi checkpoint should exist in MessAgentix/stage45-e2e/checkpoints/ to resume fine-tuning from.", required: false, detail: "If absent, training starts from the pretrained Moshi base model (auto-downloaded)." },
      { category: "resource", label: "TPU v5e-8 (recommended) or GPU A100/L4", description: "TPU v5e-8 is recommended for fastest training. GPU A100 or L4 also supported but with lower throughput.", required: true },
      { category: "resource", label: "Disk Space: ~50 GB", description: "Space for training data download, model weights, and checkpoint saves during training.", required: true },
      { category: "resource", label: "RAM: ~16 GB", description: "Host RAM for data loading and preprocessing before pushing to TPU.", required: true },
      { category: "config", label: "JAX/Torch XLA Compatible", description: "Training code uses PyTorch XLA for TPU. The Kaggle TPU runtime provides this automatically.", required: true },
    ],
    sessionMaxHours: 9,
    enableInternet: true,
    estimatedDiskGb: 50,
    estimatedRamGb: 16,
  },
  {
    id: "tpu_synth",
    label: "Synthetic Data Generation (TPU)",
    notebookFile: "session_tpu_synth.ipynb",
    stages: ["p5a", "p5b", "p5c"],
    stageLabel: "P5: Synth",
    description:
      "Runs large-scale speech synthesis using the fine-tuned Moshi model on TPU. Generates domain-specific synthetic conversations across banking, healthcare, restaurant, and education domains. Also handles audio interleaving and final upload to domain-specific HF repositories.",
    compatibleDevices: ["tpu_v5e", "tpu_vm_v3", "gpu_a100", "gpu_l4"],
    recommendedDevice: "tpu_v5e",
    outputHfRepos: ["domain_restaurant", "domain_banking", "domain_healthcare", "domain_education", "stage45_e2e"],
    inputHfRepos: ["stage45_e2e", "stage3_agent"],
    requirements: [
      { category: "api", label: "Kaggle Internet Access", description: "TPU kernel needs internet to download model checkpoints and upload synthesized audio to Hugging Face.", required: true },
      { category: "api", label: "Gemini API (optional)", description: "Used for dynamic episode generation if template-based episodes are insufficient. Not strictly required.", required: false },
      { category: "env", label: "HF_TOKEN_SECONDARY", description: "Hugging Face write token for domain-specific repos and MessAgentix/stage45-e2e output.", required: true },
      { category: "env", label: "CF_WORKER_URL", description: "Cloudflare Worker URL for heartbeat and queue coordination.", required: true },
      { category: "env", label: "CF_WORKER_SECRET", description: "Authentication secret for the Cloudflare Worker API.", required: true },
      { category: "data", label: "stage45-e2e fine-tuned checkpoint", description: "A fine-tuned Moshi checkpoint must exist in MessAgentix/stage45-e2e/checkpoints/. Produced by tpu_finetune (p5_finetune).", required: true, detail: "Run tpu_finetune before this session to produce the checkpoint." },
      { category: "data", label: "stage3-agent episode templates", description: "Agent episode JSONL provides dialogue templates for synthesis. Must exist in MessAgentix/stage3-agent.", required: true },
      { category: "resource", label: "TPU v5e-8 (recommended) or GPU A100/L4", description: "Required for real-time speech synthesis at scale. TPU v5e-8 is recommended for best throughput.", required: true },
      { category: "resource", label: "Disk Space: ~60 GB", description: "Space for model download, episode templates, and synthesized audio output before upload.", required: true },
      { category: "resource", label: "RAM: ~16 GB", description: "Host RAM for batch audio generation and interleaving operations.", required: true },
      { category: "config", label: "Domain Config Available", description: "Domain-specific tool registry and intent taxonomy configs must be in the dataset for guided synthesis.", required: true },
    ],
    sessionMaxHours: 9,
    enableInternet: true,
    estimatedDiskGb: 60,
    estimatedRamGb: 16,
  },
];

// ── Helper Functions ──────────────────────────────────────────────────────────

export function getSessionById(id: string): SessionConfig | undefined {
  return SESSIONS.find((s) => s.id === id);
}

export function getDeviceById(id: string): RuntimeDevice | undefined {
  return RUNTIME_DEVICES.find((d) => d.id === id);
}

export function getAccountById(id: string): KaggleAccount | undefined {
  return KAGGLE_ACCOUNTS.find((a) => a.id === id);
}

export function getHfRepoById(id: string): HfRepo | undefined {
  return HF_REPOS.find((r) => r.id === id);
}

export function getCompatibleDevices(sessionId: string): RuntimeDevice[] {
  const session = getSessionById(sessionId);
  if (!session) return [];
  return RUNTIME_DEVICES.filter((d) => session.compatibleDevices.includes(d.id));
}

export function getRecommendedHfRepos(sessionId: string): HfRepo[] {
  return HF_REPOS.filter((r) => r.recommendedFor.includes(sessionId));
}

export function getOutputHfRepos(sessionId: string): HfRepo[] {
  const session = getSessionById(sessionId);
  if (!session) return [];
  return HF_REPOS.filter((r) => session.outputHfRepos.includes(r.id));
}

export function getInputHfRepos(sessionId: string): HfRepo[] {
  const session = getSessionById(sessionId);
  if (!session) return [];
  return HF_REPOS.filter((r) => session.inputHfRepos.includes(r.id));
}

// Category label mapping for display
export const REQUIREMENT_CATEGORY_LABELS: Record<SessionRequirement["category"], string> = {
  api: "API / Services",
  env: "Environment Variables",
  data: "Data Prerequisites",
  resource: "Resources",
  config: "Configuration",
};

export const REQUIREMENT_CATEGORY_ORDER: SessionRequirement["category"][] = [
  "api",
  "env",
  "data",
  "resource",
  "config",
];
