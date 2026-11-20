# 更新日志

本插件的变更记录。版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)：
功能增加升次版本，修错升修订版本，破坏配置兼容性才升主版本。

## 0.3.2

### 修复

- **积分胶囊的点击区域比看上去小**。按钮原本写死 `height:24px`，而输入框工具栏那一行比
  文字高，胶囊上下各留出一条「看起来属于它、实际不属于它」的空白，点在文字边上没有反应。
  改为 `align-self:stretch` 并去掉固定高度，整格都成为点击目标。外层
  `.dcu-pill-wrap` 补上 `align-items:center` / `min-width:0`，两个不同字重的 span
  不再按基线对齐（否则高度会在两种状态间跳一格），名字过长时也改为省略号而不是撑宽整行。

### 测试

- 新增 `tests/test_click.cjs`：用 **happy-dom + 真 React** 挂载胶囊，派发
  `pointerdown → mousedown → mouseup → click` 的完整原生序列，断言点击后弹层确实挂到
  `document.body`、列出全部账号、并按触发器矩形定位。之前只测「渲染出来了吗」，
  测不到「点下去有没有反应」。

## 0.3.1

### 修复

- **设置页与积分胶囊整页空白**。`Card` 被写成了
  `function Card({...}, ...rest)`，并把 `rest` 当成子元素渲染。React 调用函数组件时
  会传**第二个参数**（旧版 context 对象），于是这个 `{}` 被当成子元素交给 React，
  抛出 `React error #31: Objects are not valid as a React child` —— 一抛就把整棵子树
  清空，所以「设置 → Updream」和输入框胶囊**同时**变空白。`Card` 现在只读
  `props.children`，7 处调用改成在 props 里传 `children`。
- **测试为什么没抓到**：之前所有断言都用自己写的假 React，它会把普通对象当标签渲染，
  因此把这类错误完全掩盖了。新增 `tests/test_realrender.cjs`，用**真的 React**
  （`react-dom/server` 的 `renderToString`，在 Node 里同步执行）逐个渲染 `Card`、
  `Badge`、`Switch` 等组件并带一个子元素。已验证：把 `...rest` 改回去，这项立刻
  `FAIL Card renders with a child`。

## 0.3.0

### 重制

- **设置页与积分胶囊的界面整体重做**。原来的样式表是从 `dsh-connect-workbuddy`
  整段拷来的（146 KB / 556 条规则），其中 79%（293 个类）在这个插件里从未被引用，
  另有 19 个选择器重复定义。重写后的样式表 128 条规则 / 28 KB，每个类都有用武之地，
  `tests/test_css.cjs` 会守住这一点。详见 [docs/UI-REDESIGN.md](docs/UI-REDESIGN.md)。

### 修复

- **浅色主题下「保存」按钮几乎看不见** —— `.dcu-btn-primary` 用
  `background: var(--dsw-alias-label-primary)` 配 `color: var(--dsw-alias-bg-layer-3)`，
  而 `--dsw-alias-bg-layer-3` **在主题里根本不存在**：文字颜色落空，浅色背景上就成了
  浅色字。主按钮现在用 `--dsw-alias-brand-primary` 配白字。
- **引用了 16 个不存在的主题变量** —— 原先引用的 28 个 `--dsw-*` 里有 12 个不是运行时
  注册的 token（`bg-layer-3`、`label-dimmed`、`interactive-bg-hover`、`bg-l1`、
  `label-error`、`elevation-prominent` 等），全靠硬编码深色兜底，于是浅色主题下这些
  位置仍然是深色。现在只引用真实存在的 13 个 token，并且**不再写兜底值**：
  将来 token 若被重命名，两套主题都会立刻暴露，而不是悄悄退回深色。
- **11 处 `var()` 连兜底都没有** —— 变量缺失时整条声明失效（`.dcu-btn-outline`、
  `.dcu-composer-panel` 等）。现已全部消除。
- **积分胶囊文案粘在一起** —— 账号名与积分是两个不同字号的 span，只靠 flex gap 分隔，
  读屏与复制时会连成「账号甲28,750」。
- **导航图标从来没显示过** —— `UpdreamLogo` 被引用但从未定义，每次加载都在
  `settings.section.icon` 的注册回调里抛 `ReferenceError`，被外层 catch 吞掉。
  现在真的画出来了。

### 结构调整（行为不变）

- 设置页有页头（图标 + 标题 + 说明）、下划线式页签、分组卡片、吸底保存栏。
- 账号行：状态圆点 + 名称（当前账号带「当前」徽章）+ Key 提示 + 右对齐余额列 + 操作。
  余额会在打开页面时自动读取，不再需要逐行点「读余额」。
- 模型行：原生复选框 + 名称 + 模型 id + 档位徽章；当前档位跑不了的模型保留但置灰。
- 诊断栏补上会员档位与刷新间隔两行。
- 摘要里那句字面量 `**不可恢复**` 改成中文引号。

## 0.2.0

### 新增

- **`updream_task`** —— 查询一个已提交的生成任务的状态与结果，可选等到结束。
  生成工具在自己的等待预算内没等到结果时会带着 `task_id` 报错并提示"任务仍在服务端运行"，
  但在此之前**没有任何工具能接着查它** —— 错误信息指着一个不存在的工具。
  现在这句话能兑现了：传 `task_id` 继续查，不必重新提交（重新提交会再扣一次积分）。
  归在「画布与素材」这组开关下，因为它是免费、只读的。
- **测试套件** —— `tests/run.mjs` 一个入口跑完全部离线检查：
  工具定义一致性、配置规范化、输入框积分读数、样式与 workbuddy 逐字节一致。
  `npm test` / `npm run check` 都能跑。
- **`updream_projects`** —— 列出当前账号的项目。之前换账号后找项目只能靠猜
  `project_id`，或者去设置页点"刷新项目列表"。
- **`updream_node_update`** —— 改已有节点的标题、提示词、模型与坐标。
  之前能建节点、能删节点，却没有改节点的办法：想改一句提示词只能删了重建，
  而重建会丢掉该节点的生成历史。
- **`updream_node_disconnect`** —— 删除一条连线。之前能连线、能删节点（删节点会连带删掉它的连线），
  但不能单独断开一条线。这三个上游接口（`projects`/`updateNode`/`disconnect`）本来就已经写好，
  只是没有对应的工具。

### 修复

- **视频工具的超时短于宿主上限** —— `timeoutMs` 原本是 780 秒，而宿主在 600 秒处强制结束调用。
  结果是插件自己的超时永远不会触发，等来的只有宿主那句不带 `task_id`、不带原因的
  `tool call timed out after 600000ms`。现在降到 570 秒，留 30 秒余量让插件先报错、
  把 `task_id` 交出去。
- **`taskTimeoutMs` 的上限高于宿主上限** —— 配置允许到 900 秒，但等待 900 秒的任务
  永远会被宿主在 600 秒处掐断。设置页因此会承诺一个运行时兑现不了的等待。
  上限改为 570 秒；`runGeneration` 里再夹一次，手改配置也越不过去。
- **`firstURLOf` 漏了 `image_url`** —— 图片节点在 `updream_canvas` 里的结果地址永远是空的，
  `updream_project_delete` 的只读检查也把满是成品的项目报成"没有产出"。
  同时把 `cover_url` 调到最后一个：视频节点同时带封面缩略图和 `video_url`，
  先取封面会让模型把一张 `.jpg` 当视频交给用户。
- **相对路径按宿主进程目录解析** —— 上传本地素材时相对路径走的是 `process.cwd()`
  （DSH 启动目录），不是会话的工作目录。在 A 项目的会话里说"上传 ./cover.png"
  会去 B 项目找。现在按调用方 Agent 的 `workingDirectory` 解析，取不到才退回进程目录。
- **输入框读数用了裸 `setInterval`** —— 浏览器半用全局 `setInterval`，
  而这一行的约定（以及测试替身）是 `window.setInterval`。测试因此会挂死在那里而不是报错。改齐。

### 变更

- `engines.node` 从 `>=22` 收紧到 `^22.19 || >=24`，与宿主自身声明一致。
- `package.json` 增加 `icon`、`scripts`、`./package.json` 导出，`files` 收录 `tests`、
  `CHANGELOG.md`、`LICENSE`。
- 包描述补上"续查未结束的生成任务"。

## 0.1.0

首个版本。

- 生图 / 生视频 / 文本三组能力，逐项开关，默认全关。
- 画布与素材：`updream_canvas`、`updream_node_create`、`updream_node_connect`、
  `updream_node_delete`、`updream_asset_upload`。
- `updream_project_delete`，独立开关，需显式 `confirm: true`。
- 多账号：一个 Key 一个账号，可切换、重命名、删除；删掉当前账号时余下的自动接手。
- 输入框积分读数胶囊；有多个账号时点开即切换菜单。
- API Key 存凭据库，不进配置、不进日志、不进页面。
