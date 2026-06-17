// build.rs — tonic-build 自动从 proto 目录编译 stubs
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("proto");

    let protos = [
        proto_dir.join("mediaagent/common.proto"),
        proto_dir.join("mediaagent/document.proto"),
        proto_dir.join("mediaagent/video.proto"),
        proto_dir.join("mediaagent/workflow_state.proto"),
    ];

    tonic_build::configure().compile(&protos, &[&proto_dir])?;

    // 触发重新构建（proto 文件变更时）
    println!("cargo:rerun-if-changed=../proto/mediaagent/common.proto");
    println!("cargo:rerun-if-changed=../proto/mediaagent/document.proto");
    println!("cargo:rerun-if-changed=../proto/mediaagent/video.proto");
    println!("cargo:rerun-if-changed=../proto/mediaagent/workflow_state.proto");

    Ok(())
}
