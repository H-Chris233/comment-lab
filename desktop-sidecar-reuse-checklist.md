# desktop sidecar reuse checklist

- [x] 梳理当前 sidecar 启动/停止路径与动态端口注入点
- [x] 增加 sidecar 复用注册信息读写（端口与 base url）
- [x] 启动时优先探测并复用已运行 sidecar
- [x] 仅在未命中复用时启动新的 python/node sidecar 并写回注册信息
- [x] 调整退出行为，避免复用场景误杀共享 sidecar
- [x] 编译与测试验证
