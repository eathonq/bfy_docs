# BFY Upgrade 工具目录

一套工具 ([bfy-upgrade.mjs](bfy-upgrade.mjs))，多份配置文件，分别对应不同的框架源：

| 入口 | 配置文件 | 框架源 |
|------|----------|--------|
| `bfy-upgrade-hwrpk.bat` | `config-hwrpk.json` | `E:/work/gitlab/HwRuntimeEncode` — 华为快游戏 Runtime 编码框架 |
| `bfy-upgrade-hwapk.bat` | `config-hwapk.json` | `E:/work/gitlab/BFYGameFrame_encode_hwApk` — 华为 APK 编码框架 (AGC + QG) |

## 命令行用法

```bash
# 快游戏 Runtime 框架 (默认配置)
node bfy-upgrade.mjs --dry-run
node bfy-upgrade.mjs -y

# 华为 APK 框架
node bfy-upgrade.mjs --config config-hwapk.json --dry-run
node bfy-upgrade.mjs --config config-hwapk.json -y

# 手动指定 Cocos 版本
node bfy-upgrade.mjs --config config-hwapk.json --cocos 2.x --dry-run
```

版本自动检测：先读目标项目 `package.json` 的 `version` 字段（Cocos 3.x），
没有则回退读 `project.json` 的 `version`（Cocos 2.x），都没有时用配置里的 `defaultVersion`。

## 注意

- 两个框架都会写 `assets/bfyGameFrame` 等目录，**同一个项目只跑对应平台的那一份配置**，不要混用。
- 新增框架源时，复制一份配置文件（改 `source`/`name`/`rules`）并新建一个 bat 入口即可，无需改动 `bfy-upgrade.mjs`。
