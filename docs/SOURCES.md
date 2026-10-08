# UnityHot 信源与内容边界

核验日期：2026-10-08。公开读取仅代表可访问，不代表允许转载。所有种子信源均 site_fulltext=false、syndicate_fulltext=false；前台只展示中文摘要与原文链接。下列来源的文章与发布说明版权归各自来源。测试夹具仅保存解析所需少量事实字段或合成内容，不是新闻存档。

| 来源 | 已核验入口 | 格式与范围 | 频率 |
|---|---|---|---|
| Unity 国际版 LTS | https://unity.com/releases/editor/lts-releases.xml | RSS；即使响应 MIME 为 Atom 也按实际 XML 解析 | 6 小时 |
| Unity 国际版 supported | https://unity.com/releases/editor/supported-releases.xml | RSS；与 LTS 重叠时仍按真实文章身份判重 | 6 小时 |
| 团结引擎版本 | https://unity.cn/tuanjie/releases | HTML 中 window.__props__.data.tuanjieRelease.releases；只 JSON.parse，不执行脚本，不读取 globalRelease | 6 小时 |
| Catlike Coding | https://catlikecoding.com/unity/tutorials/feed.atom | Unity 教程 Atom | 6 小时 |
| UWA | https://blog.uwa4d.com/feed/ | 混合技术 RSS；标题/摘要须出现 Unity、团结或 Tuanjie，再经相关性预筛 | 6 小时 |
| Netcode for GameObjects | https://api.github.com/repos/Unity-Technologies/com.unity.netcode.gameobjects/releases?per_page=10 | 公共 GitHub release JSON；排除草稿，保留预发布身份 | 6 小时 |
| Input System | https://api.github.com/repos/Unity-Technologies/InputSystem/releases?per_page=10 | 同上 | 6 小时 |

Tuanjie 的 title、原始 publishTime（毫秒）、releaseNoteUrl、releaseTags 和 hubDeepLink 按来源保留。详情仅沿 releaseNoteUrl 的 /editor…/release-note 官方路径读取 CMS RichText；结构变化或缺少正文时报错，不能拿导航文本代替。显示版本、Hub 内部版本与底层 Unity 版本分开处理。LTS for HMI 原样保留。

GitHub 未认证 REST API 通常每 IP 每小时 60 次。这里只有两个源、每源每六小时一次；JSON/RSS 都保存条件请求验证器。失败不紧密重试，沿现有采集失败退避至最多六小时；403/429 保留失败状态，不绕过限制。未来发布时间先延后收录，验证器会撤销以便重新检查；历史初次导入按历史归档，不产生“刚刚发布”热度。published、updated、first seen 保持不同字段。

发行机构 owner_entity_id 用于归属与热度去重，与 engine:* 产品标签独立。unity.cn 归属于 Unity 中国，但中文 Unity 6 文档并不会因此变成团结引擎。

## 暂不启用

- Unity Blog RSS：遇到 robots 限制，未尝试规避
- Unity Discussions：返回 403，未尝试规避
- https://developer.unity.cn/?tab=latest 和 /plate/tuanjie-engine：可访问，但分页和时效覆盖未验证，不作为完整新闻源
- https://docs.unity.cn/cn/tuanjiemanual/Manual/：技术背景，不是新闻流
- UniTask / ML-Agents：可选扩展，当前没有启用

未猜测 RSS/API 地址，没有把过时首页新闻列表当作当前团结新闻流。后续添加其他来源需核验地址、结构、频率与内容授权。
