---
description: Omni Studio GitHub 发布流程 - 安全提交、敏感数据扫描、多人协作 PR 流程（禁止直接推 main）
---

# Omni Studio GitHub 发布流程

此 workflow 整合了从本地开发到共享 GitHub 仓库的完整发布流程，包含安全检查、分支规范和 PR 合并要求。

## 核心规则

- **禁止直接推送 `main` 分支** — `main` 是全团队共享的稳定主线。所有开发必须在 `feature/*`、`fix/*`、`docs/*` 分支上进行，只能通过「审核通过 + CI 全绿」的 Pull Request 合入 main
- **只推送 `github` remote**，发布时忽略 `origin`（废弃的上游）
- **推送前必须执行敏感数据扫描**
- **Commit Message 遵循 Conventional Commits** (`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`)
- **GitHub remote 名称为 `github`**，仓库地址：`https://github.com/Dylan-Nihilo/OmniStudio.git`
- **PR 由当前已通过 `gh` 认证且拥有仓库权限的维护者账号发起**；禁止写死或自动切换到某个协作者账号
- **Git 作者使用本地已配置的作者**（本仓库已配置好，不要修改 git config），**禁止添加 `Co-Authored-By` 行**
- **合并一律使用 squash merge**，保证 main 历史「一个功能一个提交」

## 阶段一：创建工作分支

### 1. 确认当前分支

```bash
git branch --show-current
```

**必须**在 `feature/*`、`fix/*`、`docs/*` 分支上工作。如果在 main 上（或 main 已过期），先从最新 main 切出干净分支：

```bash
git fetch github
git checkout -b feature/<your-feature-name> github/main
```

**绝不直接在 main 上提交**。如果已经在 main 上有了提交，先挪到分支再推送：

```bash
git switch -c feature/<your-feature-name>
```

### 2. 敏感数据扫描

逐项执行，**任何一项命中都必须修复后才能继续**：

**搜索硬编码密钥（40+ 字符字符串）:**

```bash
git grep -E "['\"][a-zA-Z0-9_-]{40,}['\"]" -- ':(exclude)*.lock' ':(exclude)node_modules'
```

**搜索内部域名:**

```bash
git grep -i "alibaba-inc.com"
```

**搜索 API Key 模式:**

```bash
git grep -iE "(sk-|AKID|access_key|password|pwd|token|bearer)" -- ':(exclude)*.lock' ':(exclude)*.example' ':(exclude)node_modules'
```

**检查敏感文件是否被追踪:**

```bash
git ls-files | grep -E "\.env$|secret|credential|\.key$|\.pem$" | grep -v "\.example"
```

### 3. 检查 .gitignore 完整性

```bash
grep -E "^\.env|^\.agent|^CLAUDE\.md|^output/" .gitignore
```

确保至少包含：`.env`、`.agent/`、`CLAUDE.md`、`output/`

### 4. 镜像工作流对等性检查（如改动了 workflow 镜像）

如果本次改动涉及 `.claude/commands/` 或 `.codex/workflows/`，必须运行：

```bash
python3 scripts/check_workflow_parity.py
```

比对失败时：同步两侧镜像文件，或在脚本的 `WAIVERS` 中记录有意分歧及理由。

## 阶段二：代码质量（可选但推荐）

**Python 代码格式化:**

```bash
black --check src/
flake8 src/
```

**前端 Lint:**

```bash
cd frontend && npm run lint
```

## 阶段三：提交与推送

### 1. 暂存文件

```bash
git add <specific-files>
```

**不要使用 `git add .`**，逐一确认文件。

### 2. 提交

```bash
git commit -m "feat: your descriptive commit message"
```

提交前确认作者身份符合项目约定：

```bash
git log -1 --format='%an <%ae>'
```

作者使用本地已配置的作者（不要修改 git config），不要添加 `Co-Authored-By` 行。

Commit 类型：
- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 文档更新
- `style:` 代码格式（不影响逻辑）
- `refactor:` 重构
- `test:` 测试
- `chore:` 构建/工具/依赖

### 3. 推送分支到 GitHub

```bash
git push -u github <branch-name>
```

**绝不直接推 main。**

### 4. 创建 Pull Request

使用 GitHub CLI 当前已认证且拥有仓库权限的维护者账号，向 `Dylan-Nihilo/OmniStudio` 发起 PR。不要因流程文档而切换到某个固定用户名：

```bash
gh pr create --repo Dylan-Nihilo/OmniStudio --title "feat: your PR title" --body "$(cat <<'EOF'
## Summary
- <change description>

## Test plan
- [ ] <test checklist>

## Evidence
- <test output / verification links>
EOF
)"
```

如果该分支已有 PR，直接查看更新：

```bash
gh pr view --repo Dylan-Nihilo/OmniStudio
```

## 阶段四：等 CI 通过并合并

合入 main 的 PR 会自动跑 `backend-tests`（GitHub Actions）。合并前必须等它通过：

```bash
gh pr checks --watch
```

**CI 全绿且经审核后才能合并**：

```bash
gh pr merge --squash --delete-branch
```

**一律 squash 合并**，保证 main 历史「一个功能一个提交」。合并后远程分支已删除，同步清理本地：

```bash
git switch main
git branch -D <branch-name>
git fetch github
```

## 阶段五：推送后验证

- 在 https://github.com/Dylan-Nihilo/OmniStudio 确认 PR 与合并提交可见
- 检查 README 格式渲染
- 确认无敏感信息泄露

## 紧急情况：撤销敏感信息

**未 push:**
```bash
git reset --soft HEAD~1
```

**已 push:**
需要使用 BFG Repo-Cleaner 清理历史并 force push。联系团队协助。
