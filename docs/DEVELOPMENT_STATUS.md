# UnityHot 开发状态

更新：2026-10-08。独立本地目录 UnityHot，分支 feat/unityhot-local；起点/已核验 GitHub main 为 07d4c775e71a2f1ec3205a0082a21b423cb09b6e。用户已单次授权发布到 SirLpc/AIHOT 的 unityhot 分支；发布结果以 GitHub 实际引用为准。未建 PR、未改远程仓库名、未部署。TestPg 未触碰。

## 已实现

- UnityHot 原创 UH 标记、站点中文文案、主题目录、实体与产品词表、领域提示词、原创品牌图标与日报字标；保留 MIT/NOTICE
- 7 个已核验源：Unity 国际版 LTS/supported、团结引擎版本、Catlike Coding、UWA、Netcode、Input System
- 团结列表只读取 tuanjieRelease，严格 JSON 解析；详情读取官方 CMS RichText；保存显示版本、Hub 内部版本、LTS for HMI 等元数据
- 原始发布时间、更新时间、发现时间分开；未来发布时间延后收录；首次历史导入不进入当前热点；RSS/JSON 条件读取及原有失败退避
- 产品身份写入现有 tags，无数据库迁移。模型不能单独指定身份；中文/.cn 不作为团结证据，发行机构不作为产品证据
- 分组、同 URL、事件合并、近似文本/原生引用热点信号均受确定性产品/完整版本限制；跨语言同版本可合并，缺失版本不能充当已知版本间的桥梁
- 原始标题、正文、摘要中的版本证据用于判断；v 前缀和 f/t/c 等后缀完整；材料修改变更身份时撤销旧自动归属
- Feed、详情、热点、事件、报告普通条目/头条/看点/相关条目/快讯有固定产品标记，独立于手机端可隐藏的普通标签
- 摘要与原文链接默认发布；site_fulltext、syndicate_fulltext 全部关闭。外部采集、付费模型、飞书、IndexNow 默认关闭

## 验证

标准检查与结果：

| 检查 | 结果 |
|---|---|
| npm run typecheck | 通过 |
| npm test（独立 PostgreSQL 17.6、UTF-8、LZ4、pg_trgm；*_test 数据库） | 693/693 通过 |
| npm run test:standalone | 176/176 通过 |
| npm run build -w @aihot/web | 通过，客户端与 SSR 产物已生成 |
| node --test apps/web/tests/*.test.ts | 34 通过，14 浏览器依赖测试受环境阻塞，不能称整套通过 |
| scripts/smoke.ts | 30/30：页面、公开出口、图片、MCP 初始化通过 |
| scripts/mcp-check.ts | UnityHot server identity、7 个工具、有效读取、错误与参数校验通过 |
| git diff --check | 通过 |

所有模型/采集测试使用本地假服务。测试过程没有真实付费模型调用、公开发布或对外通知。烟测使用空的独立测试数据库、本地 API 与生产 Web 构建，不启动 worker。

PostgreSQL 原先不可用；便携包缺少迁移所需 LZ4，未修改迁移绕过。已在被忽略的本地运行时目录从官方 PostgreSQL 17.6 源码构建，补齐官方 LZ4 头文件与 pg_trgm；依赖构建工具来自 Debian 官方包。测试数据库只在本机回环地址监听，结束后停止。

### 尚未验证的浏览器行为

默认 Playwright Chromium/WebKit 不存在。尝试系统 Chromium 后，实际启动报 socket() failed: Operation not permitted；经批准提升执行权限仍受同一平台限制。因此没有声称视觉验收成功，没有伪造截图。

受阻共 14 项：Chromium/WebKit 原生视频（2）；导航/离线/预取/缓存到期/Agent 标签/手机搜索/阅读增强/深层返回（10）；390px 与 1280px 实际产品徽标可见性（2）。新增 SSR 行为测试已通过，包括关闭普通标签时仍渲染四种产品徽标，以及只有一条新闻的日报头条仍有徽标。

下一步应在支持 Playwright 的本地电脑或 CI 安装 Chromium/WebKit，重跑完整 Web 测试并检查手机布局。未进行 Docker 构建验收（本环境没有 Docker）。

## 独立审查与修复

新上下文审查提出六项，均已修复并先复现测试失败再验证通过：

1. 摘要中的版本证据缺失、未知版本被当成通配符
2. v6000.3.2f1 被截断成 3.2f1
3. 标题/产品专属源掩盖正文中的双产品比较
4. 材料变更产品或版本后仍保留旧自动归属（含连续两次变更先后被覆盖、尚未归组的情况）
5. 团结底层 Unity 版本、公司名称被误作第二产品
6. 日报头条、看点和相关条目缺少固定产品标记

最终定向复核已确认六项原始发现全部解决；审查者未代替作者重跑数据库测试，693/693 由实现者在最终代码上验证。没有未处理的审查重要项；未声明生产可发布。没有新增数据库结构、迁移或生产数据变更。

## 仍需用户决定

- 公开部署、域名与运营主体（远程 unityhot 分支发布已单次授权）
- 条款、隐私、联系信息及适用合规要求
- 模型服务、费用预算、采集/排程/通知开关
- 用用户标注样本校准筛选。T1=60、T1_5=65、T2=76 与五轴权重保留，尚未完成 Unity 领域质量校准

执行选择：使用用户要求的新独立 checkout 作为隔离边界，没有再创建嵌套 worktree；保留 @aihot/* 内部工作区包名，避免无意义导入重命名。它们不作为站点公开品牌。

### 当前云目录可重复执行

已安装工具链与仅本机的验证脚本保存在被忽略的 .local-runtime/；这些不是生产配置，也不会发布到远程：

- bash .local-runtime/run-native-tests.sh npm test
- bash .local-runtime/run-native-tests.sh bash .local-runtime/smoke.sh

正常有 PostgreSQL 17 的环境仍用 README 中的标准命令。发布目标为远程 unityhot 分支，origin/main 不在本次修改范围。README 和 UNITYHOT_SETUP 已包含不依赖此目录的完整正常启动流程。
