# 存储层 SQLite → MySQL 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `feature/mysql-storage` 上让 `src/storage` 同时支持 SQLite（桌面 / 本地 / 测试）和 MySQL 8.0（托管服务），并提供一条可验证、可回滚的 SQLite → MySQL 数据迁移与切换路径，为后续积分/钱包功能（`feature/credits-billing`）提供稳定的多用户存储。

**Architecture:** 保持 SQLAlchemy 2.x 声明式模型不变，把"方言相关"的三类东西收敛到 `src/storage/db.py` 与 `src/storage/dialect.py`：(1) 引擎创建与连接参数；(2) 写事务（`BEGIN IMMEDIATE` → 通用 `begin()` + 行锁）；(3) 冲突忽略插入（`OR IGNORE` → 方言化 `insert_ignore`）。Schema 只做"MySQL 也能建"的最小类型修正（键列 `Text` → `String(n)`、大字段 → `LONGTEXT`、部分唯一索引 → 生成列唯一索引），不改业务语义。数据迁移用独立脚本按外键顺序整表复制并逐表校验行数与哈希；切换靠一个环境变量 `OMNI_STUDIO_DATABASE_URL`，SQLite 文件原样保留作为回滚点。

**Tech Stack:** SQLAlchemy 2.0、PyMySQL、MySQL 8.0（InnoDB，utf8mb4）、FastAPI、pytest（SQLite 内存库 + 可选 MySQL 集成用例，`OMNI_STUDIO_TEST_MYSQL_URL` 控制）。

## Global Constraints

- **SQLite 不能被移除。** Tauri 桌面版与本地部署继续用 SQLite；所有改动必须让现有 60+ 个 pytest 在 SQLite 内存库上原样通过。
- 表名、列名、业务字段语义不变；只允许改列类型宽度、索引实现、方言语法。
- 不引入第二套 ORM 或 Alembic 之外的迁移框架；现有 `MIGRATION_REGISTRY` 版本表保留，MySQL 首版由 `Base.metadata.create_all` 建立并写入 `schema_migrations`。
- 切换期间 SQLite 文件只读不删；回滚 = 改回环境变量 + 重启。
- 不在生产 MySQL 上做未经确认的操作；建库、建用户由运维在窗口内执行（脚本给出）。

---

## 当前基线：代码里对 SQLite 的依赖（`main@54d1bd0` 盘点）

| 依赖 | 位置 | 处理 |
|---|---|---|
| 只允许 sqlite URL、`PRAGMA` 三件套、`StaticPool` | `src/storage/db.py:60-99` | 按方言分支 |
| `BEGIN IMMEDIATE` 写事务 | `db.py:102-115`；`source_repository.py`×23、`auth_repository.py`×16、`repository.py`×5、`legacy_claim.py`×3、`migrations/w3_auth.py`×2 | 保留函数名，内部按方言：SQLite 仍 `BEGIN IMMEDIATE`，MySQL 用普通事务，需要互斥的读改写处用 `SELECT ... FOR UPDATE` |
| `insert().prefix_with("OR IGNORE")` | `db.py:121,150`、`source_repository.py:1183,1950`、`auth_repository.py:477` | 新增 `dialect.insert_ignore(table)`：SQLite → `OR IGNORE`，MySQL → `IGNORE` |
| `CheckConstraint("json_valid(...)")` ×22 | `schema.py` | MySQL 8 有 `JSON_VALID()`，大小写不敏感，保留 |
| `Text` 主键 / 外键 / 唯一约束 / 索引列（26 个 Text 主键，93 处 FK） | `schema.py` | MySQL 不能给 TEXT 建键 → 键列改 `String(64)`（uuid/hash），normalized 名改 `String(255)` |
| `Text` 大字段（脚本正文、`*_json`） | `schema.py` | MySQL `TEXT` 上限 64KB，改 `Text().with_variant(LONGTEXT, "mysql")` |
| `REAL` 时间戳 ×62 | `schema.py` | MySQL `REAL`=DOUBLE，保留 |
| 部分唯一索引 `sqlite_where=(role=="owner")` | `schema.py:195` | MySQL 无部分索引 → 生成列 `owner_workspace_id = IF(role='owner', workspace_id, NULL)` + 唯一索引 |
| `sqlite3` 直读 legacy JSON 导入库、`sqlite_master` | `migration.py:17,281-287`；`db.py:124-160` 的 `sqlite_transaction` | legacy 导入只在 SQLite 路径可用，MySQL 下明确报错"请先在 SQLite 完成 legacy 认领再迁移" |
| `.env.example` / `docker-compose.yml` / `deploy_production.sh` 只认 `output/omni_studio.db` | 部署 | 增加 `OMNI_STUDIO_DATABASE_URL`；compose 增加可选 mysql 服务 |
| 业务 SQL 用 `strftime` | 无（仅 Python 端格式化） | 无需处理 |

结论：SQLite 依赖集中在 `src/storage/`，业务层（`api.py`、`pipeline.py`）不直接写 SQL，改动面可控。

---

## Task 1: 引擎与方言层

**Files:**
- Modify: `src/storage/db.py`
- Create: `src/storage/dialect.py`
- Modify: `src/storage/__init__.py`
- Modify: `.env.example`
- Modify: `requirements.txt`、`requirements-docker.txt`（新增 `PyMySQL>=1.1`、`cryptography`）
- Test: `tests/test_storage_dialect.py`

- [x] `db.py`：`resolve_database_url()` 读取 `OMNI_STUDIO_DATABASE_URL`；为空时沿用 `resolve_default_db_path()` 生成 sqlite URL。
- [x] `create_engine()`：去掉 "must use SQLite" 断言；`sqlite` 分支保留 PRAGMA 与 `StaticPool`；`mysql` 分支设置 `pool_pre_ping=True, pool_recycle=1800, pool_size=10, max_overflow=20`，`connect_args={"charset": "utf8mb4"}`，连接后执行 `SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'` 与 `SET time_zone='+00:00'`。
- [x] `begin_immediate()`：SQLite 保持 `BEGIN IMMEDIATE`；其他方言用 `connection.begin()`。别名 `sqlite_transaction` 保留。
- [x] `dialect.py`：`insert_ignore(table)`、`is_sqlite(engine)`、`is_mysql(engine)`、`longtext()` 类型工厂。
- [x] 替换 5 处 `prefix_with("OR IGNORE")`。
- [x] 测试：sqlite URL、mysql URL（用 `create_engine(..., strategy="mock")` 或仅断言 URL/参数）都能构造；`insert_ignore` 在 SQLite 上行为不变。

## Task 2: Schema 的 MySQL 兼容修正

**Files:**
- Modify: `src/storage/schema.py`
- Modify: `src/storage/migrations/w3_auth.py`（DDL 字符串只用于 SQLite 升级路径，加方言守卫）
- Test: `tests/test_storage_schema.py`（补 MySQL DDL 编译用例）

- [x] 定义类型别名：`KEY = String(64)`、`NAME = String(255)`、`SHORT = String(32)`、`BIG = Text().with_variant(LONGTEXT, "mysql")`。
- [x] 逐表把主键、外键、唯一约束、索引里的 `Text` 列改为 `KEY`/`NAME`/`SHORT`；`*_json`、`content`、`text`、`prompt` 等改为 `BIG`；其余 `Text` 不动。
- [x] `workspace_memberships`：新增 `owner_workspace_id` 生成列（`Computed("IF(role='owner', workspace_id, NULL)", persisted=True)`，SQLite 用 `CASE WHEN`），唯一索引改建在该列上；删除 `sqlite_where`。
- [x] 字符集/排序规则由 compose 的 mysql 服务参数与建库语句统一（`utf8mb4` / `utf8mb4_0900_ai_ci`），表级不重复声明。
- [x] `CheckConstraint` 名称保持唯一（MySQL 要求库内唯一）。
- [x] 测试：`CreateTable(t).compile(dialect=mysql.dialect())` 对 30 张表全部成功，且不含 `TEXT` 键列；SQLite 全量测试仍通过。

## Task 3: 数据迁移脚本

**Files:**
- Create: `scripts/migrate_sqlite_to_mysql.py`
- Create: `scripts/sql/mysql_bootstrap.sql`
- Test: `tests/test_migrate_sqlite_to_mysql.py`（用两个 SQLite 文件做源/目标验证复制逻辑）

- [x] `mysql_bootstrap.sql`：`CREATE DATABASE omnistudio CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; CREATE USER 'omnistudio'@'%' ...; GRANT ...`。
- [x] 脚本：`--source sqlite:///output/omni_studio.db --target mysql+pymysql://... [--dry-run] [--truncate]`
  1. 目标库 `Base.metadata.create_all()`；写入 `schema_migrations` 当前版本。
  2. 按 `Base.metadata.sorted_tables`（外键拓扑序）逐表复制，批量 1000 行，`SET FOREIGN_KEY_CHECKS=0` 包裹。
  3. 每表比对：行数一致；对主键排序后逐行 `sha256(json.dumps(row, sort_keys=True, default=str))` 做整体哈希一致。
  4. 输出报告 JSON（每表行数、哈希、耗时），任一不一致非零退出。
- [x] `--dry-run` 只做源库统计与目标连通性检查。

## 生产环境现状（2026-09-09 只读盘点）

- 主机：阿里云新加坡 `47.236.165.75`（SSH host `47`），4 核 / 14G / 磁盘 49G 用 38%，1Panel 管理。
- 部署：`/opt/omnistudio/app`，docker compose 两个容器 `omni-studio-backend`（127.0.0.1:17177）、`omni-studio-frontend`（0.0.0.0:3000→80）；`.deployed-commit = 54d1bd0`（= 当前 main HEAD）。另有 UI 站点 `/opt/omnistudio-ui`（80 端口，独立 compose）。
- 数据：`output/lumenx.db`（沿用旧文件名）≈1 MB + WAL 0.5 MB，`schema_migrations = w3.1-auth`；users 4 / workspaces 4 / projects 15 / jobs 3。`output/` 共 54 MB（assets、video、uploads 等媒体仍在本地卷）。
- 备份：`/opt/omnistudio/backups/lumenx.db.<ts>.bak`，由 `deploy_production.sh` 每次部署前生成；无定时备份。
- **主机上没有 MySQL。** 需要二选一：(A) 在同一 compose 里加 `mysql:8.0` 服务 + 命名卷 + 每日 `mysqldump` 到 `/opt/omnistudio/backups`；(B) 阿里云 RDS MySQL 8.0（新加坡）。推荐先 A（数据量 MB 级，一小时内可上线，零额外费用），RDS 作为后续升级路径，切换只需改 URL。

## Task 4: 部署与配置

**Files:**
- Modify: `docker-compose.yml`（新增 `mysql:8.0` 服务：`command: --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci --default-time-zone=+00:00`，命名卷 `mysql_data`，healthcheck `mysqladmin ping`，`backend` 增加 `depends_on: mysql: condition: service_healthy`；端口只绑 127.0.0.1）
- Modify: `requirements*.txt`（PyMySQL、cryptography）
- Modify: `scripts/deploy_production.sh`（备份分支：sqlite 用 `.backup`，mysql 用 `mysqldump --single-transaction`）
- Modify: `README.md` / `USER_MANUAL.md` 部署章节

- [x] `.env.example` 增加：
  ```
  # 留空 = 本地 SQLite；托管部署填 MySQL
  OMNI_STUDIO_DATABASE_URL=mysql+pymysql://omnistudio:***@127.0.0.1:3306/omnistudio?charset=utf8mb4
  ```
- [x] `/health` 增加 `storage: {dialect, ok}` 字段（执行 `SELECT 1`）。

### 验证记录（2026-09-09，本机 Docker mysql:8.0.45）

- SQLite 全量测试：684 passed / 2 skipped（含新增 `tests/test_storage_dialect.py`、`tests/test_migrate_sqlite_to_mysql.py`）。
- MySQL：`init_schema` 建 30 张表并可幂等重跑；owner 唯一性由生成列索引拦截；`INSERT IGNORE` 去重；`metadata_json` 的 `DEFAULT ('{}')` 与 `JSON_VALID` 检查生效；`AuthRepository` 创建用户/工作区正常；迁移脚本 SQLite→MySQL 往返校验通过；FastAPI 应用以 `OMNI_STUDIO_DATABASE_URL` 启动，`/health` 返回 `storage: {dialect: mysql, ok: true}`。

## Task 5: 切换演练与上线

### 上线记录（2026-09-10 02:43 UTC，`47.236.165.75`，部署 `31a425d`）

- 第一次切换在复制 `sessions` 时失败：生产 refresh-token 哈希是 `sha256:<hex>`（71 字符），超出 `VARCHAR(64)`；脚本按设计自动回滚到 SQLite 后端，服务中断约 20 秒。修复：哈希列改 `VARCHAR(128)`（`e7c4942`），迁移脚本新增 VARCHAR 宽度预检（dry-run 即可发现）。
- 第二次切换成功：`docker compose stop backend` → `sqlite3 .backup` 冷备（`/opt/omnistudio/backups/lumenx.db.pre-mysql.*.bak`）→ 一次性容器跑迁移（16 张有数据的表行数与哈希全部一致，报告 `output/migration-report-<ts>.json`）→ 写入 `OMNI_STUDIO_DATABASE_URL` → `up -d backend`，`/health` 返回 `storage.dialect=mysql`。前端 3000 端口未重启。
- 只重建了 backend 镜像；前端镜像构建需要 `HEROUI_KEY`（服务器与本机均无），本次 main 相对已部署版本也没有前端改动。
- `.env` 新增 `COMPOSE_PROFILES=mysql`、`MYSQL_ROOT_PASSWORD`、`MYSQL_PASSWORD`、`OMNI_STUDIO_DATABASE_URL`；旧配置备份在 `/opt/omnistudio/backups/pre-mysql-<ts>/`。
- 每日 04:10 `mysqldump` 到 `/opt/omnistudio/backups/mysql/`（保留 14 天），脚本 `/opt/omnistudio/scripts/backup-mysql.sh`，首次运行成功（72 KB）。
- 回滚方式：删掉 `.env` 里的 `OMNI_STUDIO_DATABASE_URL`，`docker image tag omnistudio-rollback-backend:previous app-backend:latest`，`docker compose up -d backend`；SQLite 文件 `output/lumenx.db` 原样保留。

- [x] **演练（预发布）**：用生产 SQLite 的备份跑一遍脚本 → 起一个指向 MySQL 的后端实例（另一个端口）→ 跑 `scripts/run_acceptance.py` 主链验收。
- [x] **上线窗口（预计 5–10 分钟；生产库 1 MB、15 个项目，整表复制秒级）**，在 `47.236.165.75:/opt/omnistudio/app` 执行：
  1. 公告 / 前端置为只读横幅（`OMNI_STUDIO_READ_ONLY=1`，后端对写接口返回 503）。
  2. `sqlite3 output/lumenx.db ".backup '/opt/omnistudio/backups/lumenx.db.pre-mysql.<ts>.bak'"` 冷备份（含 WAL checkpoint）。
  3. 运行迁移脚本（非 dry-run）→ 报告全绿。
  4. 改 `.env` 的 `OMNI_STUDIO_DATABASE_URL` → `docker compose up -d backend` → `curl 127.0.0.1:17177/health` 确认 `dialect=mysql`；前端 3000 端口不重启。
  5. 登录 + 新建项目 + 一条 Playground 生成的冒烟。
  6. 关只读。
- [x] **回滚**：改回空 URL → 重启；窗口内的写入（理论上为 0）无需回灌。
- [x] 上线后 7 天保留 SQLite 文件与迁移报告；之后归档到备份目录。

## 为什么不做"零停机双写"

源库是单文件 SQLite，没有可靠的变更捕获；双写需要改所有仓储层且引入一致性问题。数据量在 MB 量级，整表复制秒级完成，一个 10 分钟只读窗口成本远低于双写方案的风险。

## 与积分功能分支的关系

`feature/credits-billing` 依赖本分支的两件事：(1) 键列已是 `String`，新表 `wallets / credit_ledger / price_book_versions / platform_roles` 直接按同一规范建；(2) `begin_immediate` 已方言化，钱包的冻结/结算在 MySQL 下靠 `SELECT ... FOR UPDATE`。建议本分支先合入 `main`，积分分支再 rebase。
