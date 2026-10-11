# UnityHot

Unity 国际版与团结引擎的中文开发资讯索引。聚合官方版本、Package、技术文章、实用工具与相关政策，提供中文摘要、原文链接、热点归组和日报/周报/月报。

这是基于 [AIHOT 开源框架](https://github.com/KKKKhazix/AIHOT) 的独立适配，非 Unity 官方站点。Unity 国际版和团结引擎分别标注，未知产品保持待确认；版本号与兼容性不能互相推断。

## Windows 安装与换电脑

完整步骤见 [Windows Docker 安装、试跑与迁机手册](docs/UNITYHOT_SETUP.md)：从 `D:\OtherPrjs\UnityHot` 拉取 `unityhot` 分支，生成本机密钥，初始化数据库和管理员，再按需要单篇验证或开启两源自动运行。已有安装更新、Clash Verge DNS 排错、停止、备份和恢复也在同一手册。

需要 Git 与 Docker Desktop（Linux containers、Compose v2）。容器内提供 Node 24 / PostgreSQL 17，主流程不要求宿主机另装 Node。所有 Compose 命令固定使用 `-p unityhot`；内部数据库名/账号仍为 `aihot`。

先只启动 `db setup api web`，保持 `COLLECT_ENABLED=false`、`MODEL_CALLS_ENABLED=false`，不启动 worker。网站为 http://localhost:3000，后台为 `/admin`；管理员密码由初始化脚本在本机生成，首次密码登录自动建立管理员。手册使用 `PORT=127.0.0.1:3000` 限制为本机访问。不要提交或分享 `.env`、密钥与数据备份。

首次运行页显示「队列尚未初始化」是预期状态，详见[首次预览说明](docs/UNITYHOT_SETUP.md#首次预览的运行页)。页面访问不触发模型调用。

## 单篇验证与自动运行

[首次单篇流程](docs/UNITYHOT_SETUP.md#6-只处理一篇文章的本机试跑)先在空库导入唯一一篇，暂停全部 7 个源，查询这台电脑自己的文章 ID，再停止 API/Web/worker、保持数据库运行。`scripts/single-article.ts` 默认只读预检，明确加 `--execute` 才付费；`--resume` 仅用于审计后的恢复。已经运行常驻排程的库不适用此首次流程。

本机真实单篇已完成：5 次请求，输入 20,016 / 输出 423 tokens，正文与中文摘要已验证。`default → llm` 路由使用 DeepSeek Flash、thinking disabled，5/分钟、20/小时、20/滚动 24 小时是请求次数限制，不能保证 ¥1 硬费用上限。

[两源自动运行](docs/UNITYHOT_SETUP.md#7-可选只启用两个-unity-官方-feed-的自动运行)仅启用 Unity LTS / SUPPORTED，其他 5 源暂停；用固定 `publishedAfter` 起点避免导入历史。正常 worker 还会处理归组、报告和重试等工作。已确认 worker 心跳和调度记录；两个源各自的自动抓取与新文章发布仍待核验，不能从队列为空推断成功。详细证据见[开发状态](docs/DEVELOPMENT_STATUS.md)。

## 产品边界

- Unity 国际版与团结引擎分别用 engine:unity_global 和 engine:tuanjie 标注
- 比较两者用 engine:both；缺乏证据用 engine:unknown
- 中文或 .cn 域名不代表团结引擎；来源机构不等同于产品
- 团结引擎 1.10.4、内部 2022.3.62t16 和上游 Unity 2022.3.62f1 分开保留
- 不同产品、不同完整版本不会因为模型判为相同而自动合并
- 默认只发布摘要与链接，不公开转载全文

## 检查

npm run typecheck

DATABASE_URL=postgres://127.0.0.1:5432/unityhot_test npm test

npm run test:standalone

npm run build -w @aihot/web

node --test apps/web/tests/*.test.ts

node scripts/smoke.ts --base http://localhost:3000

node scripts/mcp-check.ts http://localhost:3000/api/mcp

数据库测试必须使用 _test 或 _ci 结尾的独立数据库。浏览器测试需 Playwright 的 Chromium/WebKit。测试只使用本地模拟服务。

## 文档与上线前决策

- [开发状态与验证记录](docs/DEVELOPMENT_STATUS.md)
- [信源与来源许可说明](docs/SOURCES.md)
- [本地设置和上线检查](docs/UNITYHOT_SETUP.md)
- [框架部署文档](docs/deploy.md)
- [适配配置说明](docs/customize.md)

当前评分门槛保留 T1=60、T1_5=65、T2=76，尚未使用用户标注样本校准。运营主体、联系信息、条款、隐私、域名和生产模型服务尚待确认。未部署上线。

## 许可

保留上游 [MIT LICENSE](LICENSE) 与 [NOTICE](NOTICE)。来源文章、商标与第三方字体拥有各自权利。UnityHot 使用原创 UH 字形标记，不使用 Unity 官方 Logo。
