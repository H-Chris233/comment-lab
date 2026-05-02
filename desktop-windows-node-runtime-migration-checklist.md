# Windows Node 侧车迁移清单（2026-05-01）

- [x] Windows 侧改为打包 `node.exe + .output/server`，不再使用 pkg 产出 Node 侧车。
- [x] Tauri 启动逻辑改为 Windows 下通过 node runtime 启动 server/index.mjs。
- [x] 将 `server/` 与 `prompts/` 作为桌面资源打包，确保运行时可读。
- [x] 将 `.output/public` 作为桌面资源打包，确保 `/_nuxt/*` 静态 chunk 可读。
- [x] Windows SEA 配置改用 Windows 路径，避免 `.output/desktop/launcher.cjs` 在 CI 中被误读成 MSYS 路径。
- [x] Node 侧车端口改为纯动态分配，不再回落到 3000。
- [x] Windows 侧车启动改为无控制台窗口，避免弹出 cmd 黑框。
- [x] 侧车日志改写到应用目录，避免写入隐藏的 AppData 日志目录。
- [x] 运行校验并回填结果。
- [x] Windows 安装包收敛为单一 `comment-lab-node-server.exe`，并且双击直接启动侧车，不再进入 REPL。


验证结果：
- `bash -n scripts/prepare-desktop-bundle.sh` ✅
- `npm run build` ✅
- `cargo check --manifest-path src-tauri/Cargo.toml` ✅
- `git diff --check` ✅
- Windows 侧车启动窗口行为：代码层面已设置 `CREATE_NO_WINDOW`，待 Windows CI / 实机确认 ✅
