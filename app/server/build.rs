use std::path::Path;
use std::process::Command;

fn main() {
    let frontend_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../frontend");
    let dist_dir = frontend_dir.join("dist");

    // Skip if dist already exists (e.g. CI pre-built it)
    if dist_dir.join("index.html").exists() {
        println!("cargo::rerun-if-changed=build.rs");
        return;
    }

    let lib_frontend_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../lib/frontend");

    // npm ci for lib/frontend
    let status = Command::new("npm")
        .args(["ci", "--ignore-scripts"])
        .current_dir(&lib_frontend_dir)
        .status()
        .expect("failed to run npm ci in lib/frontend — is Node.js installed?");
    assert!(status.success(), "npm ci failed in lib/frontend");

    // npm ci for app/frontend
    let status = Command::new("npm")
        .args(["ci", "--ignore-scripts"])
        .current_dir(&frontend_dir)
        .status()
        .expect("failed to run npm ci in app/frontend — is Node.js installed?");
    assert!(status.success(), "npm ci failed in app/frontend");

    // npm run build
    let status = Command::new("npm")
        .args(["run", "build"])
        .current_dir(&frontend_dir)
        .status()
        .expect("failed to run npm run build");
    assert!(status.success(), "npm run build failed");

    println!("cargo::rerun-if-changed=build.rs");
}
