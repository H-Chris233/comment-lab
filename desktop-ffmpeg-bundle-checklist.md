# Desktop FFmpeg 打包修复清单（2026-04-29）

- [x] 将 ffmpeg 纳入桌面侧车打包产物（随安装包下发）。
- [x] 让服务端压缩流程优先使用打包 ffmpeg 路径（缺失时再回退系统 PATH）。
- [x] 将 ffmpeg 路径注入 Node 侧车运行环境。
- [x] 补充占位二进制与 Tauri 配置，避免构建期缺文件。
- [x] 运行验证并回填结果（`npm run build` + `cargo check`）。


验证结果：
- `npm run build` ✅
- `cargo check`（`src-tauri/`）✅
