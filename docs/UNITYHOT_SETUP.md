# UnityHot 本地设置与上线前检查

本地开发延续 Node >=24.11、TypeScript、React Router SSR、Fastify、PostgreSQL 17、pg-boss 与 Docker 框架。数据库需支持 LZ4；缺少 LZ4 的便携 PostgreSQL 包无法运行现有迁移，不要修改历史迁移绕过。

.env.example 的外部采集、模型、飞书与 IndexNow 开关默认 false。先配置独立开发数据库并跑迁移、种子，再启动 API/Web；不要启动 worker。管理密钥由本地安全方式生成，不能提交。API/Web 只监听本机，不能以本地测试代替上线许可。

首次导入不会迁移或修改其他站点数据。本站没有生产历史。industry/sources.json 只在 seed 时插入不存在的源，之后修改源配置须显式操作数据库/后台；删除文件中的源不会删除数据库已有源。

产品身份保存在现有 tags 字段，没有新增数据库结构。engine:* 标签由原始标题/正文或已核验的产品专属源证据决定，模型不能单独凭空指定；身份候选保留原始标题与标签。原始完整版本号不移除后缀；分组、同 URL 自动归属、热点信号和事件根合并都受同一确定性边界约束。编辑员的明确人工归属沿用框架原有优先级。

## 可复制的本地启动步骤

### Docker Compose

```bash
git clone --branch unityhot --single-branch https://github.com/SirLpc/AIHOT.git UnityHot
cd UnityHot
node scripts/init-env.ts
docker compose -p unityhot up -d --build db setup api web
docker compose -p unityhot ps
```

浏览 http://localhost:3000；/admin 使用生成的本地管理员密码。setup 服务应用原有迁移并导入信源，随后退出。未启动 worker，所以不会采集新闻、调用模型或出刊。空页面是预期，不应通过启用付费开关消除它。停止用 docker compose -p unityhot down；数据卷保留。

### 首次预览的「运行」页

业务迁移和 seed 不初始化 pg-boss。只启动上述 db/setup/api/web 时，`/admin/runs` 显示「队列尚未初始化」是正常状态；队列积压和 worker 定时任务统计显示不可用，不能解读为队列为空或任务正常。已有的任务时间线、信源健康、回执、投递及等待去重的文章仍可查看。依赖队列的重新处理和回执放行按钮暂时禁用。

打开或刷新页面仅执行读取，不建队列表、不启动 worker，也不打开采集或模型开关。预览可以一直保持此状态。如果显示「队列初始化不完整」，表示 pg-boss schema 已存在但所需表缺失，应检查初始化/升级日志；不要删除数据库卷、手工伪造队列表或为消除提示启用外部调用。

旧版本在首次预览时可能因缺少 `pgboss.job` / `pgboss.schedule` 让运行页返回 503。更新含此修复的 `unityhot` 分支后，仅需重建 API/Web；本次没有数据库迁移，无需初始化队列或清空数据。先确认当前分支和本地修改，再执行：

```bash
git switch unityhot
git pull --ff-only origin unityhot
docker compose -p unityhot up -d --build --no-deps api web
```

以上更新命令假定原预览数据库已运行。首次启动仍用前面的完整流程。若之后要启用 worker、排程、采集、模型或通知，应先分别确认其配置和授权。

### 已有 PostgreSQL 17（需 LZ4 / pg_trgm）

```bash
npm ci
node scripts/init-env.ts
createdb unityhot_dev
```

在本地编辑 .env：将 DATABASE_URL 配为当前 PostgreSQL 用户能访问的 unityhot_dev 数据库（例：postgres://127.0.0.1:5432/unityhot_dev，实际用户名/认证按本机配置），保留所有外部动作开关 false。然后执行：

```bash
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed.ts
npm run dev:api
```

另开终端，在同一目录执行 npm run dev:web。开发数据库与验证数据库必须分开；测试账号需要创建数据库权限：

```bash
DATABASE_URL=postgres://127.0.0.1:5432/unityhot_test npm test
npm run typecheck
npm run test:standalone
npm run build -w @aihot/web
npx playwright install --with-deps chromium webkit
node --test apps/web/tests/*.test.ts
```

正常 PostgreSQL / Docker 路径只依赖已跟踪源文件，不需要 .local-runtime。浏览器安装命令会安装官方 Playwright 浏览器及系统依赖，须在你允许安装软件的环境执行。本云环境的 14 项浏览器测试受启动限制，不能据 SSR 测试宣称视觉通过。

## 上线前还需明确

- 运营主体、联系方式、域名与隐私/条款，必要时 ICP 与专业审阅
- 模型服务商、凭据、费用上限与是否启用付费调用
- 外部采集、每日排程、通知、IndexNow 是否分别启用
- 用 100–200 条用户标注样本校准精选：当前保留原阈值，不声称已在 Unity 领域校准
- 来源的转载/摘要使用范围，删除或纠错渠道
- 公开部署授权（远程 unityhot 分支发布已单次授权）

site/pages 的规则和隐私说明仍是待运营者确认的开发模板。UnityHot 不代表 Unity Technologies 或 Unity 中国，不使用其官方标志，不声称官方合作或兼容认证。
