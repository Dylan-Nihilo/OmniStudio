# Omni Studio UI

Figma V3 的 React 组件封装与独立预览。依赖 React 19、Tailwind 4、HeroUI OSS 3.2.4 和 HeroUI Pro 1.0.0-beta.6。`frontend/` 已通过 Next.js 15 / React 19 / Tailwind 4 接入此包，原版对照 worktree 保留 React 18 / Tailwind 3。

## 预览与验证

```bash
cd packages/ui
npm run dev        # http://127.0.0.1:3018
npm run build      # TypeScript 检查 + 预览生产构建
npm test
python3 tests/browser_check.py  # 需先启动预览；使用 Python Playwright
```

组件开发使用项目配置的 `hpmcp` 和 `heroui-react-pro` / `heroui-pro-design-taste` skills；基础组件来自 `@heroui/react`，Pro 组件来自 `@heroui-pro/react`。本地 Pro runtime 最初复用自 `kaizo-saas`，安装沿用该项目的 `hpsetup` 分发渠道。

在仓库根目录的 `.env.local` 配置团队提供的 `HEROUI_KEY` 后，在 `frontend/` 或 `packages/ui/` 运行 `npm ci` 和 `npm run dev` 即可。也可运行 `npm run heroui:setup` 单独安装。安装凭据读取顺序：终端环境变量 → 当前目录 `.env.local` → 仓库根目录 `.env.local` → 当前目录 `.env` → 仓库根目录 `.env`。

npm 包提供安装入口；真实 Pro runtime 由锁定的 `hpsetup` 下载器补齐，版本必须与本项目声明一致。安装脚本不调用 CLI 的自动升级流程。Pro 源码、授权凭据及 node_modules 均不进入 Git；`.env.local` 也排除在 Docker 构建上下文之外。

`npm run dev` / `npm run build` 会检查已安装的 Pro runtime；完整且版本匹配时直接使用，否则调用同一安装脚本。根目录的统一开发入口也经过此前端检查。安装检查测试：`cd packages/ui && npm run test:install`。

GitHub Actions 使用仓库 Secret `HEROUI_KEY`；本地 Docker 使用同名环境变量，由 Compose/BuildKit 作为构建 secret 传入。MCP 的 Personal Token 与安装 key 分别配置，不要求官方 CLI 登录或 `HEROUI_AUTH_TOKEN`。不要通过 build arg 或提交文件传递凭据。

## 使用

```tsx
import { Button, TextField } from '@omnistudio/ui';
import '@omnistudio/ui/styles.css';

<TextField label="项目名称" value={title} onChange={setTitle} isRequired />
<Button onPress={save} isPending={saving}>保存</Button>
```

在 React 19 / Tailwind 4 宿主中声明本地依赖 `"@omnistudio/ui": "file:../packages/ui"`（路径按宿主位置调整），在根 `<html>` 添加 `omni-ui` class，让 portal 中的弹窗、下拉菜单也继承主题。样式入口含 Tailwind 与 HeroUI 样式；宿主统一使用一个入口。包导出 TypeScript 源码，Next.js 宿主需配置 `transpilePackages: ['@omnistudio/ui']`。字体由宿主加载，预览使用 Noto Sans SC / Space Grotesk / JetBrains Mono。

## 已封装

| 组件 | 基础实现 | 用途 |
| --- | --- | --- |
| Button / IconButton | HeroUI Button | Primary、Secondary、Quiet、Danger；pending、disabled；图标按钮必须提供名称 |
| TextField / PasswordField / TextAreaField | HeroUI TextField、Input、TextArea | 标签、描述、错误、required、原生表单语义、inputRef；密码按钮不提交表单 |
| SelectField | HeroUI Select / ListBox | 单选或多选、禁用选项、键盘操作、表单提交 |
| Checkbox | HeroUI Checkbox | 选中、禁用、描述、校验 |
| Tabs | HeroUI Tabs | 键盘切换、内容面板、溢出滚动 |
| ActionMenu | HeroUI Dropdown | 带名称的操作菜单、禁用项、键盘导航、Escape 关闭与焦点恢复 |
| Dialog | HeroUI Modal | 受控或 trigger 打开、关闭、焦点限制与恢复；`isDismissable={false}` 锁定提交中的弹窗 |
| StatusBadge | HeroUI Chip | 草稿、信息、警告、成功、错误；可读文字与状态点 |
| NavigationMenu | HeroUI Pro Sidebar | 可复用上下文导航；当前项、路由回调、键盘操作 |
| WorkflowSteps | HeroUI Pro Stepper | 受控步骤、方向和只读进度；不包含业务权限逻辑 |
| EmptyState | HeroUI Pro EmptyState | 标题、说明、媒体、操作区域 |

继承上游组件 props，保留状态控制和无障碍能力。所有业务文案、导航路径、模型选项、操作回调由调用方传入。此包不依赖 Studio / Atelier store、API 或鉴权。

## 设计依据

- [主流程 / 工作区 236:25](https://www.figma.com/design/EswE4t5D0wAEyjpwbXiQyN/MANGIX?node-id=236-25)
- [登录按钮 236:18](https://www.figma.com/design/EswE4t5D0wAEyjpwbXiQyN/MANGIX?node-id=236-18)：40px 高、8px 圆角、藏青主色。
- [输入框 236:15](https://www.figma.com/design/EswE4t5D0wAEyjpwbXiQyN/MANGIX?node-id=236-15)：40px 高、12px 圆角、12px 标签、6px 间距。
- 主流程实例的纯白 / 冷灰 / 藏青覆盖基础规范页残留的陶土色 token。封装新增的空状态、弹窗、流程步骤遵循同一主题，但尚未逐一对应 Figma 中的独立组件变体。

登录表单与首页操作、空状态、加载态已接入主应用。`AppShell` 使用共享页面淡入；其他业务页面继续分步迁移。组件目录的保存、导航与生成状态仅用于交互演示，不调用业务 API。

主应用使用 `install-links=true` 安装本地包，避免组件预览的 React 实例进入主应用。修改共享源码后更新包版本，并在 `frontend/` 运行 `npm install --install-links ../packages/ui`，随后重启 Next dev，确保安装内容与依赖缓存更新；全新 `npm ci` 会读取当前包源码。主应用的 `component-theme.css` 将共享组件 token 映射到现有六套主题。

## Loading 与 Motion 规范

- `Button isPending` 用于提交中的单一操作，保留按钮文字与占位，阻止重复提交。
- `LoadingState` 用于没有可保留内容的初次加载；`inline` 用于局部状态。文字由调用方提供，通过一个 `role=status` 宣告。
- `Skeleton` 由业务页面按真实内容布局组合，避免加载前后跳动；骨架本身不进入无障碍阅读顺序。
- `PageTransition transitionKey={route}` 在路由内容进入时淡入 180ms，不延迟数据请求，不替代业务状态管理。
- 控件反馈统一为 150ms；遵循系统 `prefers-reduced-motion` 与应用 `.no-motion` 设置。关闭动效时保留加载文字。
- 错误状态提供真实错误说明与重试入口；后台刷新保留已有内容，不清空成全屏 loading。
