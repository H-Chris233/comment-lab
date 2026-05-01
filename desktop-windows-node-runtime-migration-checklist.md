# Windows Node 侧车迁移清单（2026-05-01）

- [x] Windows 侧改为打包 `node.exe + .output/server`，不再使用 pkg 产出 Node 侧车。
- [x] Tauri 启动逻辑改为 Windows 下通过 node runtime 启动 server/index.mjs。
- [x] 将 `server/` 与 `prompts/` 作为桌面资源打包，确保运行时可读。
- [x] 运行校验并回填结果。


验证结果：
- `bash -n scripts/prepare-desktop-bundle.sh` ✅
- `npm run build` ✅
- `cargo check --manifest-path src-tauri/Cargo.toml` ✅
