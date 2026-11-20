# dsh-connect-updream

把 [Updream](https://www.updream.cn)（updream.cn，哔哩哔哩的 AI 创作平台）接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

装上之后，你可以在对话里直接说「帮我画一张……」，模型会调用 Updream 生图、把结果贴回来；也可以让它读画布、建节点、连线、上传本机素材。输入框旁边还有一枚积分读数，随时看得见还剩多少。

## 功能

- **生图 / 生视频 / 文本** —— 三个工具，逐项开关。开了才能在对话里用；不开就不注册，模型看不到，也就不会发起注定失败的调用。
- **画布与素材** —— 读画布节点与连线、列项目、建节点、改节点、连线、断线、删节点、上传本地文件。
- **续查任务** —— `updream_task`。生成工具在自己的等待预算内没等到结果时会带着 `task_id` 报错；任务其实还在服务端跑，用这个工具接着查，**不要重新提交**（重新提交会再扣一次积分）。
- **删项目** —— `updream_project_delete`，单独一组、默认关闭。项目删除**不可恢复**（Updream 没有项目回收站），所以调用还需要显式 `confirm: true`；不带 `confirm` 时只返回该项目的内容摘要，用来核对删的是不是想删的那个。
- **多账号切换** —— 保存多个 Key（一个 Key 就是一个账号），在设置页或输入框胶囊里切换，**下一个请求立刻用新账号**。删掉当前账号时余下的会自动接手。
- **积分读数** —— 输入框工具栏里的 `Updream · 985` 胶囊，点一下刷新；有多个账号时点开就是切换菜单。
- **Key 不进配置** —— API Key 存在 DSH 的凭据库里，设置页只显示是否已配置。
- **设置页四栏** —— 账号 / 模型 / 能力 / 诊断，配置改动是草稿，点保存才生效。

## 界面

设置页与输入框积分胶囊在 0.3.0 重做过：样式表从零写起，只用 DSH 主题真正注册的
那 13 个 token，浅色与深色主题都跟着走。改了什么、为什么改，见
[docs/UI-REDESIGN.md](docs/UI-REDESIGN.md)。

样式表单独放在 `src/ui.css`，组件源码在 `src/ui/*.js`，两者由
`node tests/build_client.mjs` 合成为 `src/client.js`（`npm run build`）。
之所以不把 CSS 直接写在 `client.js` 的模板字符串里：那个文件里只要多出一个反引号，
整段样式就会被悄悄截断，而报表上看不出来。

想看界面长什么样而不启动 DSH：

```bash
node tests/make_preview.cjs tests/_p/preview.html dark settings   # 深色 · 设置页
node tests/make_preview.cjs tests/_p/preview.html light settings  # 浅色 · 设置页
node tests/make_preview.cjs tests/_p/preview.html dark settings models  # 模型栏
```

这会把**真实组件**渲染成 HTML（不是手抄的假页面），用浏览器打开即可。

## 安装

```bash
# 在 DSH 的插件管理里安装本地目录
# Plugins → Add plugin → 选这个目录
```

或在 Agent 里：

```
plugin_manager install_bundle target=D:/Code/dsh-connect-updream
```

## 配置

1. 到 [updream.cn](https://www.updream.cn) 的「设置 → API 密钥」创建一个 `sk-` 开头的 Key（只在创建时显示一次）。
2. DSH → 设置 → Updream → 账号栏粘贴保存。插件会先向 Updream 验证一次。
3. 选一个默认项目（**换账号时记得也换项目**：项目归属于各自的账号）。
4. 模型栏刷新目录、勾选要用的模型。
5. 能力栏打开需要的那几组。

配置也可以直接写进 `cordis.patch.yml`：

```yaml
- id: dsh-connect-updream
  name: dsh-connect-updream
  config:
    defaultProjectId: "381805911536218112"
    allowImageTools: true
    showCreditsBadge: true
    pollIntervalMs: 300000
```

## 多账号

一个 Updream API Key 就是一个账号，请求以 Key 所属用户发出。插件把多个 Key 都存在凭据库里，只记录「当前用哪一个」的 id：

```text
dsh-connect-updream/account-<uuid>   { kind: 'api-key', key: 'sk-…', env: { label, upstreamId, username } }
dsh-connect-updream/active           { kind: 'api-key', key: '<uuid>' }
```

第一版只支持一个 Key（`dsh-connect-updream/default`），升级后会在首次读取时自动接管成账号，不需要重新输入。

账号之间数据互相不可见（项目、画布、素材都归各自的用户）。默认模型也会**按当前账号的会员档位挑选**，避免默认选中一个 `pro` 档位、而账号只有 `origin` 时必然失败的模型。

## 以 CLI 为执行层

插件的所有 Updream 操作都通过本机的 `updream` 命令行完成（`src/cli.js` 是这层薄桥）：请求形状、生成默认参数、版本门禁和幂等规则都由 CLI 统一维护。因此 CLI 必须在 PATH 中，或在配置里用 `cliPath` 指定绝对路径。

- **账号跟随**：切换、添加或删除账号时，插件会把当前 Key 通过 `updream auth login --api-key -` 写进 CLI 配置（`~/.updream/cli.json`，0600），保证两边始终是同一个账号。切换失败会回滚账号指针，不让两边不一致。设置页「诊断」栏能看到 CLI 当前账号与配置路径。
- **手动重同步**：若 CLI 被别处改动，可调用 `POST /plugins/dsh-connect-updream/cli/sync` 或重新切换一次账号。
- **唯一例外**：CLI 没有 `project delete` 命令，`updream_project_delete` 仍用 REST 完成删除。

## 计费

生图按张、生视频按秒，都计入你自己账号的 Updream 积分。插件不做本地预估，实际扣费以 Updream 返回为准。所有生成能力**默认关闭**，因为这是本插件里唯一「由模型自己决定花钱」的部分。

## 已知限制

- **Updream 的文本接口是一次独立问答**：没有流式、没有多轮、没有工具调用、不认 system prompt。所以本插件**不**把 Updream 的对话模型注册到 DSH 模型选择器 —— 那样会把每次带上下文的对话变成一次丢历史的请求。`updream_generate_text` 的描述里明确写了这一点。
- 图生视频只收一张首帧。
- 插件写入画布后，已打开的 Updream 网页需要手动刷新。

## 结构

```
src/cli.js        Updream CLI 桥：spawn + JSON 信封解析，唯一执行层
src/upstream.js   REST 客户端：仅供 CLI 没有的 project delete 使用，及结果解析
src/accounts.js   多账号存储：Key 列表、当前账号指针、旧版单 Key 迁移
src/config.js     配置规范化（无外部依赖，本地安装也能加载）
src/tools.js      模型可见的工具
src/index.js      Host 半：凭据、HTTP 路由、工具注册
src/client.js     浏览器半：设置页、账号切换、积分胶囊、图标
tests/            离线检查，`npm test` 跑全部；删项目那个是手动脚本
```

## 测试

```bash
npm test
```

跑的是不需要账号的部分：工具定义是否自洽（参数、输出、超时都在宿主限制之内）、
配置规范化是否把脏值挡在外面、输入框读数渲染成什么样、样式是否与
`dsh-connect-workbuddy` 逐字节一致。`tests/test_project_delete.mjs` 会真的删项目，
所以是手动脚本：`node tests/test_project_delete.mjs <api-key> <project-id>`。

## 许可

MIT
