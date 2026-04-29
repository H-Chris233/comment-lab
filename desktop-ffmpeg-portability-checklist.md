# Desktop FFmpeg 可移植性修复清单（2026-04-29）

- [x] 侧车打包脚本支持优先使用显式 `FFMPEG_BINARY`（避免默认复制系统 ffmpeg）。
- [x] CI 按平台下载可分发 ffmpeg 工件并注入 `FFMPEG_BINARY`。
- [x] 继续保留 Windows DLL 伴随复制逻辑。
- [x] 运行本地语法/配置校验并回填结果。


验证结果：
- `.github/workflows/release.yml` YAML 解析 ✅
- `bash -n scripts/prepare-desktop-bundle.sh` ✅
