# Desktop Node 侧车 MODULE_NOT_FOUND 修复清单（2026-05-01）

- [x] 调整 Node 侧车 pkg 输入路径，避免直接以 `.output/server/index.mjs` 作为入口。
- [x] 保持 prompts 资源打包参数不变。
- [x] 运行脚本语法校验并回填结果。


验证结果：
- `bash -n scripts/prepare-desktop-bundle.sh` ✅
