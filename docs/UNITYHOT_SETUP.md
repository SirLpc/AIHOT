# UnityHot：Windows Docker 安装、试跑与迁机手册

适用仓库：`SirLpc/AIHOT`，分支：`unityhot`。本手册记录截至 2026-10-11 的本地配置流程，默认工作目录为 `D:\OtherPrjs\UnityHot`。所有命令在 **PowerShell** 中逐段执行；上一段失败就停下看日志，不要直接粘贴整页执行。

- **另一台电脑全新安装**：从第 1 节开始；这是空数据库，不会带上旧电脑的文章、管理员设置、预算或采集进度。
- **已有安装更新代码**：直接看[已有安装更新](#已有安装更新)，不要重新生成 `.env` 或重做首次导入。
- **要搬走现有数据**：看[备份与迁移到另一台电脑](#备份与迁移到另一台电脑)，恢复前不要初始化目标业务库。
- **仅预览界面**：做到第 3 节即可，不需要模型 Key，也不启动 worker。
- **验证一篇文章**：第 4–6 节；只适用于空库的首次试跑，明确执行后会产生 DeepSeek 费用。
- **持续自动收集**：第 7 节；会启用正常 worker，范围比单篇试跑大，需先接受该节说明的外部请求和费用。

全文只使用占位符。真实 `.env`、API Key、管理员密码、数据库密码及备份均不提交 Git，不贴进聊天、截图或公共日志。下面的本地运行不等于公开部署许可。

## 1. 准备电脑与 Docker

安装 Git 和带 Compose v2 的 Docker Desktop，并启动 Docker Desktop。使用 **Linux containers**；Windows 上按 [Docker 官方安装说明](https://docs.docker.com/desktop/setup/install/windows-install/)完成适用的 WSL 2 / 虚拟化设置。本项目容器内使用 Node 24 和 PostgreSQL 17；下面的 Docker 主流程不要求在 Windows 宿主机安装 Node。

```powershell
git --version
docker version
docker compose version
docker info --format '{{.OSType}}'
```

确认 `docker version` 同时显示 Client 和 Server，最后一条输出 `linux`。只安装了 CLI 不代表引擎已启动。

如果出现 `open //./pipe/dockerDesktopLinuxEngine`、named pipe 不存在或 `The system cannot find the file specified`，先打开 Docker Desktop，等引擎启动，再核对容器模式和 `docker context ls`。这时还没有连到 Docker 引擎，不是 UnityHot 数据库损坏；不要删卷或重置 Docker 数据。

## 2. 拉取正确分支，生成本机配置

只对**尚不存在的安装目录**执行 clone：

```powershell
New-Item -ItemType Directory -Force D:\OtherPrjs | Out-Null
Set-Location D:\OtherPrjs
git clone --branch unityhot --single-branch https://github.com/SirLpc/AIHOT.git UnityHot
Set-Location D:\OtherPrjs\UnityHot
git branch --show-current
git log -1 --oneline
```

分支应为 `unityhot`。如仓库要求登录，使用 Git 自己的登录流程，不把 token 写进 clone URL。已有目录先核对其仓库和本地修改，不要覆盖。

在仓库目录，用官方 Node 镜像运行配置生成脚本：

```powershell
docker run --rm --mount "type=bind,source=$($PWD.Path),target=/app" --workdir /app node:24-trixie-slim node scripts/init-env.ts
```

如果宿主机已经安装 **Node >=24.11**，可以改用 `node scripts/init-env.ts`，二选一即可。脚本只生成 `.env`，不安装依赖、不启动应用；已存在 `.env` 时会拒绝覆盖。

脚本随机生成 `ADMIN_PASSWORD`、`SESSION_SECRET`、`IMG_PROXY_SIGN_SECRET` 和 `POSTGRES_PASSWORD`，并在本机终端显示管理员密码。用本地编辑器打开 `.env`，先核对或添加以下非密钥项；同一键只保留一行，保留脚本生成的四个随机值：

```dotenv
SITE_URL=http://localhost:3000
PORT=127.0.0.1:3000
TRUST_PROXY=false
COLLECT_ENABLED=false
MODEL_CALLS_ENABLED=false
FEISHU_CONTENT_PUSH_ENABLED=false
FEISHU_INTERNAL_ENABLED=false
INDEXNOW_SUBMIT_ENABLED=false
```

`PORT=127.0.0.1:3000` 让网页端口只绑定本机。仅设置 `SITE_URL=localhost` 不会限制网络监听；Compose 默认端口映射会绑定所有主机接口。API 和数据库没有对宿主机开放端口。

预览时 `LLM_API_KEY` 可保持空。不要使用 `DEV_AUTH_*` 绕过登录；Docker 以 production 模式校验密钥。无需配置通知、备份云存储或其他付费服务。

核对文件被忽略（只输出文件名，不输出秘密）：

```powershell
git check-ignore .env
git status --short
docker compose -p unityhot config --quiet
```

后续**每条 Compose 命令都保留 `-p unityhot`**。文件中的默认项目名仍是 `aihot`；省略 `-p` 可能启动另一套容器和数据卷，让已有数据看似消失。内部数据库名/账号仍叫 `aihot`，不是 `unityhot`。

## 3. 初始化数据库，只启动预览

```powershell
docker compose -p unityhot up -d --build db setup api web
docker compose -p unityhot ps -a
docker compose -p unityhot logs --tail 100 setup api web
```

`setup` 实际依次执行 `node scripts/migrate.ts` 和 `node scripts/seed.ts`：按迁移账本应用数据库结构，插入尚不存在的种子信源，然后正常退出。预期 `setup` 是 `Exited (0)`，`db` healthy，`api` / `web` running；没有常驻 worker。

打开：

- 网站：`http://localhost:3000`
- 管理后台：`http://localhost:3000/admin`
- 健康检查：`http://localhost:3000/api/health`

后台输入 `.env` 中生成的 `ADMIN_PASSWORD` 即可，没有另一个注册/创建管理员步骤。第一次密码验证成功时，程序自动建立或更新内部 `admin@local` 管理员记录和会话；这里的地址不是要填写的邮箱账户。密码丢失时在本机私下查看 `.env`，不要把整个文件输出到共享终端。

种子共有 7 个源：Unity LTS、Unity SUPPORTED、团结引擎、Catlike Coding、UWA、Netcode for GameObjects、Input System。初始数据库的源默认启用，但总开关为 false 且没有 worker，尚不会定时采集。之后需要在后台明确暂停/恢复各源。

`industry/sources.json` 只是首次插入模板。`seed` 对已有 ID 使用 `ON CONFLICT DO NOTHING`；修改该文件或重新 seed 不会覆盖后台已保存的配置、启停状态与游标，也不会删除旧源。

### 首次预览的运行页

`/admin/runs` 显示「队列尚未初始化」是正常状态：业务迁移和 seed 不初始化 pg-boss。队列统计此时是不可用，不是已经检查过且为空；已有业务统计仍可读取。刷新页面不会建队列、启动 worker 或调用模型。

如果显示「队列初始化不完整」，或旧版本运行页因缺少 `pgboss.job` / `pgboss.schedule` 返回 503，先查日志和版本，再按[更新步骤](#已有安装更新)升级。不要删卷、伪造队列表或仅为消除提示而启动 worker。

## 4. 准备 DeepSeek、模型路由与次数限制

以下是已在本机试跑过的配置组合，未来服务商是否仍提供同名模型需在自己的账户中确认。在本机 `.env` **修改现有行**：

```dotenv
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=<在本机填写你自己的DeepSeek_API_Key>
LLM_MODEL=deepseek-flash
LLM_EXTRA_JSON={"thinking":{"type":"disabled"}}
COLLECT_ENABLED=false
MODEL_CALLS_ENABLED=false
```

Key 占位符必须由你在本机替换，别保留尖括号。`/v1` 形式也被试跑命令接受，但这份流程统一使用上面的根地址。`LLM_REASONING_TOKENS` 不设置或为 `0`，`LLM_VISION` 不设置或为 `false`，`LLM_JSON_MODE` 不设置或为 `true`。

不要设置任何具名模型 Key 或额外付费兜底：`DEEPSEEK_API_KEY`、`ZHIPU_API_KEY`、`XIAOMI_MIMO_API_KEY`、`DASHSCOPE_API_KEY`、`EMBEDDING_API_KEY`、`JINA_API_KEY`、`SOCIALDATA_API_KEY` 均应为空/不存在。也不要配置无关的 `DAJIALA_KEY`。若使用 `AIHOT_CREDENTIALS_DIR`，还要私下核对其中配置，单篇命令也会检查额外凭据文件。

以下步骤的环境变量都不设置，或明确填 `default`：

```text
PREFILTER_MODEL SCORE_MODEL UNDERSTAND_MODEL SUMMARIZE_MODEL STRUCTURE_MODEL
GROUP_MODEL GROUP_REVIEW_MODEL DIGEST_MODEL REPORT_MODEL TRANSLATE_MODEL
```

修改 `.env` 后，先让预览 API 重新加载配置；`restart` 不会重新读取 Compose 的 `env_file`：

```powershell
docker compose -p unityhot up -d --no-deps --force-recreate api web
```

到 `/admin/models`「模型与评测」核对每项当前路由。下拉选项用 **`default（llm）`**，不要选择具名 `deepseek-flash（deepseek）`。两者用的 Key 和预算服务不同。存在后台覆盖时逐项切换并填写原因；后台覆盖优先于环境变量，环境变量优先于 `site/models.ts` 默认值。「恢复默认」只有在环境变量也没有具名覆盖时才会回到 `default`。

到 `/admin/settings`「设置 → 付费请求上限」，找到 **`llm`** 行，保存：

- 每分钟：`5`
- 每小时：`20`
- 每天：`20`

这些是过去 1 分钟 / 1 小时 / 24 小时的**滚动请求次数**，不是自然日零点清零，也不是人民币金额。每个实际发送的重试也占次数；填 `0` 会停用该服务。不能删除预算行来“暂停”，缺少预算行会失去该服务的次数约束。

单篇命令还限制整段首次试跑跨 `--resume` 累计不超过 20 次请求，不自动等待预算恢复。正常 worker 则会按其重试机制等待/恢复；20/天可持续按滚动窗口消耗，不能当成整个安装的总费用上限。

当前 LLM 回执没有货币费用值，`cost` / 费用显示为空或「未定价」不代表免费。5/20/20 无法保证 ¥1 硬上限；金额请到自己的 DeepSeek 账单核对，¥1 只能作为人工观察目标。

## 5. 可选：Clash Verge / fake-IP DNS 排错

仅当你使用 Clash Verge 且出现 `Blocked private address`、DNS 解析到 fake-IP 等问题时处理。先检查实际容器解析结果；这条命令只查询 DNS，不运行 worker、不调用模型：

```powershell
docker compose -p unityhot run --rm --no-deps worker node -e "require('node:dns').lookup('unity.com', {all:true}, (error, addresses) => { if (error) { console.error(error.code); process.exitCode = 1; } else { console.log(addresses); } });"
```

将域名替换成 `api.deepseek.com` 可另查模型域名。这里必须写 `require('node:dns')`；只写 `dns.lookup(...)` 会得到 `ReferenceError: dns is not defined`，那不是 DNS 故障。

如果使用默认 fake-IP 黑名单过滤模式，且域名返回 `198.18.x.x` 等代理虚拟地址，在 Clash Verge 的当前**订阅右键 → 扩展覆写配置**（不同版本可能称「扩展配置」）中合并这些 DNS 排除项：

```yaml
dns:
  fake-ip-filter:
    - '+.unity.com'
    - '+.unity.cn'
    - '+.catlikecoding.com'
    - '+.uwa4d.com'
    - '+.github.com'
    - '+.deepseek.com'
```

这只是需要补入的条目，**不是用来覆盖整个配置的完整文件**。先备份当前配置，把原有 `dns.fake-ip-filter` 条目一起保留，只保留一个 `dns` 键，并保留其他 DNS/规则字段。此列表在覆写中可能整体替换原列表；如果使用白名单过滤模式或自定义 DNS 脚本，先核对现有语义，不能直接照抄。保存并重新应用当前订阅后，再从容器执行同一 DNS 检查。扩展配置合并规则见 [Clash Verge 官方说明](https://www.clashverge.dev/guide/extend.html)。

目标是让请求通过正常公共 DNS 与应用校验；不要关闭 SSRF 防护、设置 `ALLOW_PRIVATE_NETWORK_FETCH`、硬编码绕过地址或忽略 TLS 证书警告。未解决之前不进入真实模型试跑。

## 6. 只处理一篇文章的本机试跑

### 6.1 仅适用于首次空库，先暂停全部 7 个源

这是一条严格的首次验证路径：目标必须是数据库唯一一篇文章，所有源暂停，没有常驻排程、其他待办/活动任务、运行中采集、无关事件或 pending/unknown 回执。普通网页 editorial 源才支持。已经持续运行或恢复了旧数据的安装不要走这条路径，更不能清库来满足条件。

先打开 `/admin/sources`，逐个进入源详情点击「暂停」，填写原因，最终确认 7 个源全部暂停。「暂停」保留文章、历史和配置。

只修改 `unity-lts-releases` 的「采集配置（JSON）」为下面的首次导入配置，保存并复查；其他元数据、T1、参与方式、全文开关保持原值。如果已有额外配置，合并下面键而非抹掉它们：

```json
{
  "feedUrl": "https://unity.com/releases/editor/lts-releases.xml",
  "sortByPublishedAt": true,
  "_aihot": {
    "initialBackfillLimit": 1
  }
}
```

首次导入按发布时间倒序最多取 1 条；`initialBackfillLimit` 在源尚无 `cursor.initializedAt` 时才生效，不是以后每次最多 1 条。本次为了验证处理链路允许一篇历史稿，先不加第 7 节的 `publishedAfter`。默认首次回溯只考虑近约 12 个月，源暂无符合条件文章时可能得到 0 条，不能把 0 条当成功完成试跑。

### 6.2 手动导入唯一一篇，不启动 worker

核对 `.env` 两个总开关仍是 `false`。**不要点击「立即采集」**来替代下面的命令：按钮只是排队，没有常驻 worker 就不会消费，且额外源任务会导致单篇预检拒绝。

```powershell
docker compose -p unityhot exec -T db psql -U aihot -d aihot -c "SELECT count(*) AS article_count FROM articles; SELECT id, enabled FROM sources ORDER BY id;"
```

先确认文章数 `0`、全部源 `enabled=f`；不满足就停下，不执行下面的采集。确认后执行：

```powershell
docker compose -p unityhot stop -t 210 api web worker
docker compose -p unityhot build api web worker
docker compose -p unityhot run --rm --no-deps -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false worker node scripts/collect.ts unity-lts-releases
```

`db` 保持运行。上面的 `worker` 是 Compose 服务配置名；指定 `node scripts/collect.ts ...` 后执行的是一次性采集脚本，**不是**默认常驻 worker 入口。

`collect.ts` 有意使用 `force:true`，可以在源已暂停和总开关 false 时向这个指定公开 RSS 发请求，并把结果写入数据库。它不消费分析任务、不调模型，但入库排队时会初始化 pg-boss。两个开关 false 不是这个运维脚本的网络禁用开关，不要对其他源批量运行。

检查命令 JSON 结果必须 `status: "ok"`、`created: 1`。`found` 是列表条目数，可能远大于 1；真正入库数看 `created` 和下面 SQL。脚本的退出码不能代替它的 JSON 状态。失败、0 条或超过 1 条时先诊断，不反复采集或删文章来凑条件。

```powershell
docker compose -p unityhot exec -T db psql -U aihot -d aihot -c "SELECT count(*) AS article_count FROM articles; SELECT id, title, published_at, processing_state, body_status FROM articles ORDER BY discovered_at DESC LIMIT 5;"
$articleId = "粘贴本次查询得到的完整文章ID"
```

新安装必须用**自己数据库查询得到的 ID**。此前电脑、截图、示例或其他人的 ID 不能复用。

### 6.3 先只读预检，再明确付费执行

保持 API/Web/worker 停止、数据库运行：

```powershell
docker compose -p unityhot run --rm --no-deps worker node scripts/single-article.ts "$articleId"
```

默认只读预检应返回 `status: "preflight"`、目标 ID、剩余请求数和费用警告；不发模型请求，也不初始化/修复队列。看到近期心跳时确认旧 worker 确实已停止，等待至少 3 分钟再查。缺少队列表说明单篇导入未按上述路径完成；已有排程说明不是严格首次试跑现场。遇到拒绝就检查原因，不删除队列表/排程或启动常驻 worker 绕过。

确认目标、路由、次数限制正确，并接受这篇文章的真实模型费用后，才执行：

```powershell
docker compose -p unityhot run --rm --no-deps worker node scripts/single-article.ts "$articleId" --execute
```

`--execute` 只在这一个进程打开模型开关，`.env` 仍为 false。命令会执行目标的正文提取、分析与必要归组；目标通知/媒体任务取消并计入 `skippedJobs`。不注册常驻排程，不出综述/报告，不做全文翻译，不消费其他文章任务，也不自动重试。

最多运行 10 分钟后停止开启新调用，等待在途请求和回执结算；单个模型请求最长 180 秒。Ctrl+C/SIGTERM 也会先等结算，不要强杀容器或连续中断。

执行结束后，阅读 `status`、`requests`、`promptTokens`、`completionTokens` 和错误，再只恢复 API/Web：

```powershell
docker compose -p unityhot up -d --no-deps --force-recreate api web
```

### 6.4 看文章、费用和失败恢复

- `/admin/content`「内容诊断」**先输入**完整 ID、URL 或标题关键词再点击「查找」；空白页不是“数据库没有文章”。检查正文状态、分析结果、中文标题摘要和公开出口。
- `/admin/runs` 查看 `trial.article:<ID>` 时间线和回执。`complete` 表示试跑流程终态；被筛为 BLOCK 也可能正常完成，不能仅凭 complete 宣称文章发布。
- 旧稿保留原始日期和历史身份，可能不出现在「今天」或当前热点。不要修改日期把历史稿伪装成今天。
- 在 DeepSeek 自己的账单核对实际金额；本地 token/次数不是货币账单。

只有 `stopped` 等需要继续、且已经审计文章/任务/回执后才用 `--resume`。成功的首次运行不要再复制执行；续跑也可能付费：

```powershell
docker compose -p unityhot stop -t 210 api web worker
docker compose -p unityhot run --rm --no-deps worker node scripts/single-article.ts "$articleId" --resume
# 上一条预检通过并确认继续付费后，才执行下一条。
docker compose -p unityhot run --rm --no-deps worker node scripts/single-article.ts "$articleId" --execute --resume
docker compose -p unityhot up -d --no-deps --force-recreate api web
```

已收到的可复用回执会复用，不会创建新的 attemptTag；明确拒绝或输出无效的请求可能再次收费。pending/unknown 回执、活动任务和其他不确定状态必须先人工审计，命令不会自动放行或抢占。不要启动正常 worker 来“自动修复”严格单篇现场。

## 7. 可选：只启用两个 Unity 官方 feed 的自动运行

这是从一次性验证进入**正常后台运行**的单独选择。正常 worker 除抓取外还可能处理积压文章、事件归组/综述、周报月报、符合条件的全文翻译、失败重试及恢复任务；不能把它称为“只抓两个 feed 的进程”。所有模型步骤仍走 `default → llm` 才能共用 5/20/20 限制。

### 7.1 在关闭开关、停止 worker 时配置源

本节可跳过第 6 节的单篇试跑，但必须先完成第 1–4 节的安装、模型路由与预算配置。**全新 seed 的 7 个源默认都启用，不能假定已经暂停。**

先停 worker（如有），将 `.env` 中 `COLLECT_ENABLED`、`MODEL_CALLS_ENABLED` 都设为 `false`，重建 API/Web 容器以加载关闭状态，保留网页便于编辑。检查队列、回执及已有待处理文章，弄清楚启动后会继续哪些工作。飞书和 IndexNow 继续关闭，全文公开/分发继续关闭。

```powershell
docker compose -p unityhot stop -t 210 worker
# 先在本机 .env 将两个总开关设为 false，再执行下一条。
docker compose -p unityhot up -d --no-deps --force-recreate api web
```

进入 `/admin/sources`，逐个暂停全部 7 个源，确认「启用」计数为 `0`。如果曾添加其他源，也一并暂停。即使跳过了第 6 节，也不能省略这一步。随后在后台只准备这两个源，保留各自的 `feedUrl`，将 `sortByPublishedAt` 设为 `true`，补一个**固定的启用时间下界** `publishedAfter`。以下 `2026-10-11T00:00:00.000Z` 是本次试运行选定的 UTC 起点；另一台电脑新开一次试运行时，选定自己要保留的起点，两个源用同一个值。

`unity-lts-releases`：

```json
{
  "feedUrl": "https://unity.com/releases/editor/lts-releases.xml",
  "sortByPublishedAt": true,
  "publishedAfter": "2026-10-11T00:00:00.000Z",
  "_aihot": {
    "initialBackfillLimit": 1
  }
}
```

`unity-supported-releases`：

```json
{
  "feedUrl": "https://unity.com/releases/editor/supported-releases.xml",
  "sortByPublishedAt": true,
  "publishedAfter": "2026-10-11T00:00:00.000Z",
  "_aihot": {
    "initialBackfillLimit": 1
  }
}
```

合并并保留已有其他必要配置。保存后可用「预览抓取」查看日期过滤后的候选，预览会访问来源但不入库、不调用模型；没有晚于起点的版本时 0 条正常。预览条目数不是初次限量入库数。

`publishedAfter` 要求文章有可靠时间且严格晚于这个时间点，并排除未来日期。它是固定起点，**不要每天推进到“今天零点”**，否则可能漏掉轮询间隔或延迟发布的内容。它不会删除/重新分析已存历史稿。首次限量只作用于首次导入；后续可能一次收录多条近期更新，不等于每天 1 条。

然后仅「恢复」LTS 和 SUPPORTED；其他 5 个保持暂停。恢复使源立即到期，正常调度会收集它；不要先启动所有 7 个再逐个暂停。采集间隔沿用种子的 `360` 分钟（之后后台自适应任务可能调整）；每分钟运行调度器不等于每分钟重抓每个源。

只读核对：

```powershell
docker compose -p unityhot exec -T db psql -U aihot -d aihot -c "SELECT count(*) FILTER (WHERE enabled) AS enabled_count, count(*) FILTER (WHERE enabled AND id NOT IN ('unity-lts-releases','unity-supported-releases')) AS unexpected_enabled_count FROM sources; SELECT id, enabled, interval_minutes, config->>'feedUrl' AS feed_url, config->>'sortByPublishedAt' AS sort_by_published_at, config->>'publishedAfter' AS published_after FROM sources ORDER BY id; SELECT service, per_minute, per_hour, per_day FROM budgets WHERE service='llm';"
```

必须确认 `enabled_count=2`、`unexpected_enabled_count=0`，仅 `unity-lts-releases` 和 `unity-supported-releases` 两行的 `enabled=t`；其余五个种子源（及任何另外添加的源）均为 `f`，日期/地址正确且 `llm` 限制为 5/20/20。任一不符就留在两个总开关 false 的状态修正，**不要进入 7.2**。

### 7.2 明确接受自动处理后启用两个总开关

在 `.env` 中只将这两行改为：

```dotenv
COLLECT_ENABLED=true
MODEL_CALLS_ENABLED=true
```

代码更新过就先执行[已有安装更新](#已有安装更新)中的备份、拉取、重建、迁移检查；不能让 API/Web/worker 混跑新旧代码。已经完成更新、数据库正常运行时，用以下命令让三个进程读取本机配置：

```powershell
docker compose -p unityhot up -d --no-deps --force-recreate api web worker
docker compose -p unityhot ps -a
docker compose -p unityhot logs --tail 100 worker
```

`up --no-deps` 不会帮你启动或迁移数据库，仅在前面的初始化/更新成功后使用。修改 `.env` 后只 `restart` 或只重建镜像都不够，必须重建容器才能加载新环境变量。

### 7.3 验证自动流程确实在运行

到 `/admin/runs` 检查 worker 心跳新鲜且绿色。等跨过调度时间后再刷新，`sources.schedule` 应出现成功记录。页面「定时任务」显示的是当前已登记任务的**已执行历史**，不是完整的注册清单；刚启动尚无执行历史时可以为空。

按三层证据区分：

1. **调度器运行**：worker 心跳和 `sources.schedule` 为 ok。
2. **源实际抓取**：两个源详情的「采集记录」新增成功时间，检查 `found_count` / `new_count` / 错误；0 条不一定失败。
3. **新文章处理与发布**：有符合日期的上游新版本时，内容诊断中的文章、中文摘要、处理状态与公开结果更新。仅调度成功、队列空或旧的 5 条回执不能证明新文章已自动发布。

可用下列只读查询区分旧试跑与新的实际抓取：

```powershell
docker compose -p unityhot exec -T db psql -U aihot -d aihot -c "SELECT id, enabled, last_fetch_at, last_ok_at, next_fetch_at, health, fail_count, last_error FROM sources WHERE id IN ('unity-lts-releases','unity-supported-releases') ORDER BY id; SELECT source_id, started_at, finished_at, status, found_count, new_count, error FROM fetch_runs ORDER BY started_at DESC LIMIT 10;"
```

**截至 2026-10-11 的实际记录**：首次真实单篇终端结果为 `complete`，5 次请求，输入 20,016 tokens、输出 423 tokens；文章已分析、正文为 ok，中文摘要已发布。04:35 UTC 的本机截图确认 worker 心跳绿色、`sources.schedule` 0 失败 / 4 次执行、队列为空、回执 completed 5 / unknown 0。当时仅两源启用、五源暂停。该截图尚未确认两个源各自的自动抓取记录或新的自动文章，不能把首次单篇的 5 次回执当成自动采集成功证据。详细验证范围见[开发状态](DEVELOPMENT_STATUS.md)。

### 停止自动运行，保留数据与网页

先让在途调用正常结算：

```powershell
docker compose -p unityhot stop -t 210 worker
```

再把 `.env` 中 `COLLECT_ENABLED`、`MODEL_CALLS_ENABLED` 都改回 `false`，并使 API/Web 加载关闭状态：

```powershell
docker compose -p unityhot up -d --no-deps --force-recreate api web
```

需要完全暂停来源时，也在后台暂停两源。停止容器不会清除排程、队列或历史；以后明确恢复 worker 会继续符合条件的待办。后台显示旧心跳一小段时间不代表容器仍在运行，结合 `docker compose -p unityhot ps -a` 判断。

## 已有安装更新

不重新 clone、不重新生成 `.env`、不重置数据库、不重复首次采集。先检查本地修改并做下一节的备份；有未提交改动或 `--ff-only` 失败时先处理冲突，不使用 `reset --hard` 覆盖个人修改。

```powershell
Set-Location D:\OtherPrjs\UnityHot
git status --short
git branch --show-current
git switch unityhot
git pull --ff-only origin unityhot
git log -1 --oneline
```

先正常停止进程，再将 `.env` 两个总开关改为 false，保留所有其他现有设置：

```powershell
docker compose -p unityhot stop -t 210 api web worker
docker compose -p unityhot build setup api web worker
docker compose -p unityhot up -d db
docker compose -p unityhot run --rm --no-deps setup
```

`setup` 返回成功后才能继续。它会迁移和补入缺少的种子，不会覆盖已有源编辑。迁移报错时检查日志、权限和占锁事务，不跳过迁移或删卷。只要代码更新，API/Web/worker 使用的共同镜像都应重建；`git pull` 不会更新已经构建的镜像。

先恢复无付费预览：

```powershell
docker compose -p unityhot up -d --no-deps --force-recreate api web
docker compose -p unityhot ps -a
docker compose -p unityhot logs --tail 100 api web
```

这次单篇功能/运行页修复没有新增业务迁移，但标准更新步骤仍检查迁移账本。要恢复正常自动运行，先复查两源、固定日期与 `llm` 预算，再按第 7 节把两个总开关设为 true、重建三个容器。已运行过常驻 worker 的数据库不再满足首次单篇 CLI 的无排程条件。

## 备份与迁移到另一台电脑

### 需要带走什么

Git 只复制代码。文章、源配置/游标、后台模型覆盖、预算、回执和排程在 PostgreSQL 卷里；本地上传/截图等在 `data` 卷里。`.env` 在宿主机，被 Git 和 Docker 构建上下文排除。正常流程不依赖 `.local-runtime`。

- **只想搭同样的新站**：按第 1–7 节重新设置，得到空库。
- **想继续原来的站**：保存一致的数据库备份和 data 文件包，同时记录 Git 提交、源配置和关闭状态；在新电脑的空卷恢复。
- 密钥用自己的安全方式单独保管/在新机重新填写；不要放进 Git、公开网盘或共享聊天。备份含私有内容和会话资料，同样需要受限存储。

以下为手动迁机配方，按仓库 Compose 布局和 PostgreSQL 工具校核，**本次文档改动没有实际执行跨电脑恢复演练**。先保留旧机原卷和备份，确认新机完整通过后再决定旧数据处置。

### 旧电脑：停止写入，导出数据库和文件

使用仓库外的备份目录，避免不慎提交。以下每条成功后再继续；不要直接用 Windows PowerShell 的 `>` 重定向二进制 dump：

```powershell
$backupDir = "D:\UnityHotBackups\$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Force $backupDir | Out-Null
docker compose -p unityhot stop -t 210 api web worker
docker compose -p unityhot exec -T db pg_dump -U aihot -d aihot --format=custom --no-owner --file=/tmp/unityhot.dump
docker compose -p unityhot exec -T db pg_restore --list /tmp/unityhot.dump
docker compose -p unityhot cp db:/tmp/unityhot.dump "$backupDir\unityhot.dump"
docker compose -p unityhot run --rm --no-deps -v "${backupDir}:/backup" worker sh -c 'tar -czf /backup/unityhot-data.tar.gz -C /data .'
docker compose -p unityhot run --rm --no-deps -v "${backupDir}:/backup:ro" worker tar -tzf /backup/unityhot-data.tar.gz
Get-FileHash "$backupDir\unityhot.dump", "$backupDir\unityhot-data.tar.gz" -Algorithm SHA256
git rev-parse HEAD
```

保存两份文件、校验值和提交号。文件包包含整个 data 卷，包括缓存/可能存在的本地备份，所以可能较大；数据库和文件应作为同一组使用。保留旧机 API/Web/worker 停止，以免迁机期间两边同时采集、写入或付费。查看 `ps -a` 和日志确认旧进程已退出；如仍有 pending/unknown 回执，先审计，不通过恢复绕过。

### 新电脑：只对全新空库恢复

1. 完成第 1–2 节，最好先检出备份记录的相同 Git 提交，避免把较新数据库交给旧代码。生成新机自己的 `.env`，两个总开关为 false；不要执行第 3 节的业务初始化，也不要启动 API/Web/worker。
2. 安全复制备份文件到新机仓库外目录，比较 SHA256。按需要在本机填写 Key；更换管理员密码/会话密钥会使旧会话失效。
3. 新机若已存在 `unityhot` 数据卷、文章或业务表，停止操作；下面没有覆盖/清库步骤。不要把恢复当作对现有库的合并。

```powershell
# 改为新机实际收到的备份目录。
$backupDir = "D:\UnityHotBackups\替换为备份目录名"
Get-FileHash "$backupDir\unityhot.dump", "$backupDir\unityhot-data.tar.gz" -Algorithm SHA256
docker compose -p unityhot build setup api web worker
docker compose -p unityhot up -d db
docker compose -p unityhot ps -a
docker compose -p unityhot exec -T db psql -U aihot -d aihot -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');"
```

等数据库 healthy。最后的查询应没有任何业务/pg-boss 表；有结果就不要继续恢复。Compose 命名卷可能来自以前的安装，不能只凭目录是新建的判断。

```powershell
docker compose -p unityhot cp "$backupDir\unityhot.dump" db:/tmp/unityhot.dump
docker compose -p unityhot exec -T db pg_restore --list /tmp/unityhot.dump
docker compose -p unityhot exec -T db pg_restore -U aihot -d aihot --no-owner --exit-on-error /tmp/unityhot.dump
docker compose -p unityhot run --rm --no-deps -v "${backupDir}:/backup:ro" worker sh -c 'tar -xzf /backup/unityhot-data.tar.gz -C /data'
docker compose -p unityhot run --rm --no-deps setup
docker compose -p unityhot up -d --no-deps --force-recreate api web
```

只恢复你自己的可信文件包，保留归档内的目录结构。任何恢复命令失败都先停下，不对半恢复数据库反复覆盖重试。核对文章数、源启停/配置、预算、模型路由、回执和上传文件；旧排程/待办也会恢复，暂不启动 worker。确认原机不会同时运行，再按第 7 节明确恢复自动运行。

`POSTGRES_PASSWORD` 只影响空卷初始化：在有数据的旧卷上单改 `.env` 不会改变 PostgreSQL 现有密码。密码不匹配时应修正配置或按数据库管理员流程处理，不能通过删除卷“修复”。

## 常用命令与禁止的恢复捷径

```powershell
# 查看容器和最近日志。
docker compose -p unityhot ps -a
docker compose -p unityhot logs --tail 100 api web worker
# 完整停止并移除容器/网络，保留命名卷。worker 留足结算时间。
docker compose -p unityhot down --timeout 210
```

- 不执行 `down -v`、删卷、数据库 reset 或 Docker Desktop 的数据清理来解决普通启动错误。
- 不把 `.env`、凭据或数据目录提交；不要共享完整 `docker compose config` 输出（会展开环境变量）。校验用 `config --quiet`。
- 本文各例保持 `-p unityhot`，否则可能连到另一套卷。工作目录也必须正确。
- 预览空白先分清无文章、日期筛选、内容诊断未输入查询、BLOCK 和实际错误，不通过打开模型开关“修复页面”。
- 生产安装保留 Node >=24.11 / PostgreSQL 17（LZ4、pg_trgm）；不要修改已发布迁移绕过缺少 LZ4 的 PostgreSQL 包。

## 非 Docker 开发与上线边界

非 Docker 开发使用独立 PostgreSQL 17 数据库，先 `npm ci`、生成 `.env`，设置本机 `DATABASE_URL`，在两个总开关 false 时运行 `node --env-file=.env scripts/migrate.ts` 和 `node --env-file=.env scripts/seed.ts`，再分别 `npm run dev:api` / `npm run dev:web`。Windows 优先使用本文 Docker；完整非 Docker/WSL 与生产参考见 [框架部署文档](deploy.md)，不要直接照其全服务启动例子开启 worker。

测试数据库必须与用户数据分开，名称以 `_test` / `_ci` 结尾。标准检查在 [README](../README.md#检查)，历史结果在 [开发状态](DEVELOPMENT_STATUS.md)；旧检查通过不代表本次 Windows 镜像、浏览器或迁机已重新验收。

公开部署前仍需运营主体、联系方式、域名、隐私与条款确认，来源使用范围及删除/纠错渠道，单独的费用和通知决定，以及公开部署授权。当前 `site/pages` 是开发模板；UnityHot 不代表 Unity Technologies 或 Unity 中国。当前评分门槛保留 T1=60、T1_5=65、T2=76，尚未以用户标注样本校准。

### 配置与行为的代码依据

- [Compose 服务、卷和 stop grace period](../docker-compose.yml)、[Dockerfile](../Dockerfile)
- [本地密钥初始化](../scripts/init-env.ts)、[管理员密码登录](../packages/backend/src/admin/auth.ts)
- [迁移](../scripts/migrate.ts)、[只补入缺失源的 seed](../scripts/seed.ts)、[7 个种子源](../industry/sources.json)
- [模型路由](../packages/backend/src/editorial/models.ts)、[default 对应 llm](../packages/backend/src/providers/llm.ts)、[滚动预算与回执](../packages/backend/src/providers/receipts.ts)
- [强制单源导入脚本](../scripts/collect.ts)、[首次导入限制](../packages/backend/src/sources/collect.ts)、[固定发布时间过滤](../packages/backend/src/sources/filters.ts)
- [单篇 CLI](../scripts/single-article.ts)、[环境预检](../scripts/single-article-options.ts)、[隔离与执行](../packages/backend/src/jobs/single-article.ts)
- [正常 worker](../apps/worker/src/main.ts)、[排程](../apps/worker/src/schedules.ts)、[运行页读取](../packages/backend/src/admin/runs.ts)
