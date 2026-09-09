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

- [ ] `db.py`：`resolve_database_url()` 读取 `OMNI_STUDIO_DATABASE_URL`；为空时沿用 `resolve_default_db_path()` 生成 sqlite URL。
- [ ] `create_engine()`：去掉 "must use SQLite" 断言；`sqlite` 分支保留 PRAGMA 与 `StaticPool`；`mysql` 分支设置 `pool_pre_ping=True, pool_recycle=1800, pool_size=10, max_overflow=20`，`connect_args={"charset": "utf8mb4"}`，连接后执行 `SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'` 与 `SET time_zone='+00:00'`。
- [ ] `begin_immediate()`：SQLite 保持 `BEGIN IMMEDIATE`；其他方言用 `connection.begin()`。别名 `sqlite_transaction` 保留。
- [ ] `dialect.py`：`insert_ignore(table)`、`is_sqlite(engine)`、`is_mysql(engine)`、`longtext()` 类型工厂。
- [ ] 替换 5 处 `prefix_with("OR IGNORE")`。
- [ ] 测试：sqlite URL、mysql URL（用 `create_engine(..., strategy="mock")` 或仅断言 URL/参数）都能构造；`insert_ignore` 在 SQLite 上行为不变。

## Task 2: Schema 的 MySQL 兼容修正

**Files:**
- Modify: `src/storage/schema.py`
- Modify: `src/storage/migrations/w3_auth.py`（DDL 字符串只用于 SQLite 升级路径，加方言守卫）
- Test: `tests/test_storage_schema.py`（补 MySQL DDL 编译用例）

- [ ] 定义类型别名：`KEY = String(64)`、`NAME = String(255)`、`SHORT = String(32)`、`BIG = Text().with_variant(LONGTEXT, "mysql")`。
- [ ] 逐表把主键、外键、唯一约束、索引里的 `Text` 列改为 `KEY`/`NAME`/`SHORT`；`*_json`、`content`、`text`、`prompt` 等改为 `BIG`；其余 `Text` 不动。
- [ ] `workspace_memberships`：新增 `owner_workspace_id` 生成列（`Computed("IF(role='owner', workspace_id, NULL)", persisted=True)`，SQLite 用 `CASE WHEN`），唯一索引改建在该列上；删除 `sqlite_where`。
- [ ] 所有表 `mysql_charset="utf8mb4"`, `mysql_collate="utf8mb4_0900_ai_ci"`, `mysql_engine="InnoDB"`。
- [ ] `CheckConstraint` 名称保持唯一（MySQL 要求库内唯一）。
- [ ] 测试：`CreateTable(t).compile(dialect=mysql.dialect())` 对 30 张表全部成功，且不含 `TEXT` 键列；SQLite 全量测试仍通过。

## Task 3: 数据迁移脚本

**Files:**
- Create: `scripts/migrate_sqlite_to_mysql.py`
- Create: `scripts/sql/mysql_bootstrap.sql`
- Test: `tests/test_migrate_sqlite_to_mysql.py`（用两个 SQLite 文件做源/目标验证复制逻辑）

- [ ] `mysql_bootstrap.sql`：`CREATE DATABASE omnistudio CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; CREATE USER 'omnistudio'@'%' ...; GRANT ...`。
- [ ] 脚本：`--source sqlite:///output/omni_studio.db --target mysql+pymysql://... [--dry-run] [--truncate]`
  1. 目标库 `Base.metadata.create_all()`；写入 `schema_migrations` 当前版本。
  2. 按 `Base.metadata.sorted_tables`（外键拓扑序）逐表复制，批量 1000 行，`SET FOREIGN_KEY_CHECKS=0` 包裹。
  3. 每表比对：行数一致；对主键排序后逐行 `sha256(json.dumps(row, sort_keys=True, default=str))` 做整体哈希一致。
  4. 输出报告 JSON（每表行数、哈希、耗时），任一不一致非零退出。
- [ ] `--dry-run` 只做源库统计与目标连通性检查。

## Task 4: 部署与配置

**Files:**
- Modify: `docker-compose.yml`（可选 `mysql` 服务 + healthcheck，或注释指向外部 MySQL）
- Modify: `Dockerfile.backend`（无改动则确认 PyMySQL 已装）
- Modify: `scripts/deploy_production.sh`（备份分支：sqlite 用 `.backup`，mysql 用 `mysqldump --single-transaction`）
- Modify: `README.md` / `USER_MANUAL.md` 部署章节

- [ ] `.env.example` 增加：
  ```
  # 留空 = 本地 SQLite；托管部署填 MySQL
  OMNI_STUDIO_DATABASE_URL=mysql+pymysql://omnistudio:***@127.0.0.1:3306/omnistudio?charset=utf8mb4
  ```
- [ ] `/health` 增加 `storage: {dialect, ok}` 字段（执行 `SELECT 1`）。

## Task 5: 切换演练与上线

- [ ] **演练（预发布）**：用生产 SQLite 的备份跑一遍脚本 → 起一个指向 MySQL 的后端实例（另一个端口）→ 跑 `scripts/run_acceptance.py` 主链验收。
- [ ] **上线窗口（预计 5–10 分钟，数据量 MB 级）**：
  1. 公告 / 前端置为只读横幅（`OMNI_STUDIO_READ_ONLY=1`，后端对写接口返回 503）。
  2. `sqlite3 .backup` 冷备份。
  3. 运行迁移脚本（非 dry-run）→ 报告全绿。
  4. 改 `.env` 的 `OMNI_STUDIO_DATABASE_URL` → `docker compose up -d backend` → `/health` 确认 `dialect=mysql`。
  5. 登录 + 新建项目 + 一条 Playground 生成的冒烟。
  6. 关只读。
- [ ] **回滚**：改回空 URL → 重启；窗口内的写入（理论上为 0）无需回灌。
- [ ] 上线后 7 天保留 SQLite 文件与迁移报告；之后归档到备份目录。

## 为什么不做"零停机双写"

源库是单文件 SQLite，没有可靠的变更捕获；双写需要改所有仓储层且引入一致性问题。数据量在 MB 量级，整表复制秒级完成，一个 10 分钟只读窗口成本远低于双写方案的风险。

## 与积分功能分支的关系

`feature/credits-billing` 依赖本分支的两件事：(1) 键列已是 `String`，新表 `wallets / credit_ledger / price_book_versions / platform_roles` 直接按同一规范建；(2) `begin_immediate` 已方言化，钱包的冻结/结算在 MySQL 下靠 `SELECT ... FOR UPDATE`。建议本分支先合入 `main`，积分分支再 rebase。
