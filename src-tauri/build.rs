fn main() {
  // values a release build carries (set by the release workflow, never in the code)
  for v in ["TESSERA_ITAD_KEY", "TESSERA_GOOGLE_CLIENT_ID", "TESSERA_GOOGLE_CLIENT_SECRET", "TESSERA_REPO"] {
    println!("cargo:rerun-if-env-changed={v}");
  }
  tauri_build::build()
}
