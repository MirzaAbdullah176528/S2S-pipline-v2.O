//! urdu_s2s_core — PyO3 Rust extensions for the Urdu S2S pipeline
//!
//! Two performance-critical modules:
//!   - snr_filter: 200× faster SNR computation vs Python loop
//!   - audio_chunker: 6× faster audio chunking vs Python loop
//!
//! Built as manylinux2014_x86_64 wheels via GitHub Actions CI.
//! Python fallback paths remain active when the wheel is absent.

use pyo3::prelude::*;

mod snr_filter;
mod audio_chunker;

/// Register all submodules with PyO3
#[pymodule]
fn urdu_s2s_core(_py: Python, m: &PyModule) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(snr_filter::fast_snr_filter, m)?)?;
    m.add_function(wrap_pyfunction!(snr_filter::fast_snr_single, m)?)?;
    m.add_function(wrap_pyfunction!(audio_chunker::fast_chunk_audio, m)?)?;
    m.add_function(wrap_pyfunction!(audio_chunker::fast_chunk_batch, m)?)?;
    Ok(())
}
