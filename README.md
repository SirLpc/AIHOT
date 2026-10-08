# UnityHot

Unity 国际版与团结引擎的中文开发资讯索引。聚合官方版本、Package、技术文章、实用工具与相关政策，提供中文摘要、原文链接、热点归组和日报/周报/月报。

这是基于 [AIHOT 开源框架](https://github.com/KKKKhazix/AIHOT) 的独立适配，非 Unity 官方站点。Unity 国际版和团结引擎分别标注，未知产品保持待确认；版本号与兼容性不能互相推断。

## 拉取和本地预览（Docker）

需要 Git、Node.js >=24.11（只用于生成本地配置）以及 Docker Compose。以下仅启动数据库、初始化、API 和网页，不启动采集/模型 worker。

```bash
git clone --branch unityhot --single-branch https://github.com/SirLpc/AIHOT.git UnityHot
cd UnityHot
node scripts/init-env.ts
docker compose -p unityhot up -d --build db setup api web
```

打开 http://localhost:3000。管理员密码由 init-env 在本机终端显示一次，并保存到被忽略的 .env。仅浏览本地界面不需要模型 Key。不要把 .env 或密钥提交到 Git/贴进聊天。

结束预览：docker compose -p unityhot down（保留数据库卷；不要随意加 -v）。完整设置与非 Docker 流程见 [UnityHot 设置说明](docs/UNITYHOT_SETUP.md)。Docker 流程沿用框架配置，本云环境没有 Docker，尚未实际验收镜像构建。

COLLECT_ENABLED、MODEL_CALLS_ENABLED、FEISHU_*_ENABLED、INDEXNOW_SUBMIT_ENABLED 默认关闭。不要为预览启动 worker。外部采集、模型预算、排程、通知及公开部署须另行确认；页面访问不触发模型调用。

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
