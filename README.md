# 后来居上组管理后台

这是供单人安排 AI 漫剧团队任务的本地工作台。首页保留农场外观，直接展示今天需要留意的任务、未来三天交付、谁在做什么和本周交付。团队、任务历史、周/月日历、成员头像、自定义背景和浅色/深色模式继续可用。

## 成品下载与首次打开

源码位于[私有 GitHub 仓库](https://github.com/zengyies-ux/houlai-jushang-group-admin)。正式发布后，从 [v0.3.2 Release](https://github.com/zengyies-ux/houlai-jushang-group-admin/releases/tag/v0.3.2) 下载**成品 ZIP** 和 `SHA256SUMS.txt`；不要下载 GitHub 自动生成的 Source code ZIP，它不能直接运行。该直达地址在正式发布前可能尚不可访问；若页面不存在、只有草稿或缺少成品附件，请等待验证和发布完成。

1. 先读 [办公 Mac 部署与更新](docs/办公Mac部署与更新.md)，确认办公 Mac 是 Apple 芯片。当前 Mac 成品仅适用于 macOS arm64；Intel Mac 需要另行构建与验证。
2. 下载文件名以 `macos-arm64.zip` 结尾的成品附件，核对 SHA-256 后解压。双击顶层文件夹里的 `启动.command`；浏览器应打开 `http://127.0.0.1:4173`。
3. 看见「后来居上组管理后台」首页后，在「设置 → 技术信息与数据位置」核对版本和数据目录，再录入真实数据。结束服务时双击同文件夹的 `停止.command`。关闭浏览器不会停止服务。

安装包自带运行时，无需在办公 Mac 另外安装 Node.js。核心功能无需连接 GitHub；联网只用于下载和更新。

## 三台设备怎么分工

| 设备 | 日常用途 | 数据 |
| --- | --- | --- |
| 开发 Mac | 开发、测试、制作成品，使用隔离测试数据 | 不作为正式业务库 |
| 办公 Mac | 长期运行正式服务 | 唯一正式数据位于 `~/Library/Application Support/AIShortDramaWorkbench/data/` |
| Windows | 浏览器通过可信局域网访问办公 Mac | 不安装运行包，不另建业务库 |

办公 Mac 首次运行会建空工作台，不导入演示数据。已有办公数据不可被开发机数据库覆盖。办公 Mac 应保持开机、联网且不休眠；现有启动脚本在前台终端运行，关闭终端或系统重启后需要重新启动。本版没有自动开机运行，也不会自动下载和安装更新。Windows 浏览器应使用办公 Mac「设置 → 局域网访问」列出的地址，不能使用 Windows 自己的 `127.0.0.1`。

Windows x64 独立运行包仍保留构建能力，日常连接办公 Mac 时不需要它。各平台 CI、解压成品和目标设备的实际验收结果见 [V0.3.2 验证与发布记录](docs/V0.3.2-验证与发布记录.md)；CI 检查不等于办公 Mac 已安装或 Windows 实机已验收。

## 先做什么、怎么看提醒

先在「团队」建小组和成员，再到「任务」建任务，填名称、负责人和截止日。人员中途加入、退出或换负责人时，在任务详情的「参与人员 → 调整人员」保存变化，时间线会保留记录。

首页左侧「今天需要留意」包含未完成的逾期、今天截止、人工标记可能延期和待确认任务；右侧「未来三天交付」包含明天、后天、大后天截止的未完成任务。任务可同时进入两区，但总数只计一次。点各区「查看全部」进入对应筛选。提醒按工作台业务时区的自然日计算，只在网页打开时持续显示；关闭网页后不会发送系统通知、邮件或推送。「临近截止」表示日期接近，不是系统预测延期。完整操作见 [使用说明](docs/使用说明.md)。

## 源码开发

开发 Mac 需要 macOS arm64、Node.js **24.11.1** 和 npm。开发数据与办公 Mac 正式数据必须分离：

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

Mac arm64 在本平台运行 `npm run package:mac`；Windows x64 应在 Windows x64 上运行 `npm run package:windows`，使原生 SQLite 模块在目标平台安装与验证。自动构建见 [build-release.yml](.github/workflows/build-release.yml)。`release/` 下的 ZIP 和校验清单用于发布；业务数据库、备份、日志、口令和运行状态不能进入 Git。

源码分为 `apps/web`（页面）、`apps/server`（API 与 SQLite）、`packages/shared`（共享规则）、`drizzle`（迁移）与 `scripts`（打包和冒烟验证）。版本历史见 [CHANGELOG](CHANGELOG.md)。
