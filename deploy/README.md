# deploy/

生产托管站点里不属于 compose 项目、但同样必须跟随仓库发布的部分。`main` 每次生产部署（`.github/workflows/deploy-production.yml`）都会从这里重新渲染，服务器上的手工修改会被覆盖——要改请改这里。

| 路径 | 作用 | 发布到 |
| --- | --- | --- |
| `production.conf` | 公开地址 `OMNI_STUDIO_PUBLIC_URL`，域名只在这里设置 | 前端构建参数（其它主机自动跳转到此地址）、后端鉴权来源白名单、网关主机名 |
| `website/` | 落地页 `index.html` / `main.js` / `styles.css`，「开始创作」链到 `/app/` | `/opt/omnistudio/website/releases/repo-<hash>`，`current` 软链原子切换 |
| `gateway/studio.caddy` | 单域名分流：`/` 落地页、`/app/*` 应用、其余路径应用；旧域名 301 | `/opt/kaizo/downloads/Caddyfile` 中 `omnistudio-public` 标记之间的段落 |

- 落地页的视频、图片、字体（约 80 MB）不进仓库，留在服务器 `/opt/omnistudio/website/shared/assets`；新增素材先传到那里，再在 `website/` 里引用，发布脚本会检查引用是否都存在。
- 本地预演（不改动任何东西）：在服务器上 `bash scripts/deploy_public_site.sh --check`。
- 更换域名：只改 `production.conf`，路径必须保持 `/app/`；新主机的 DNS 需先指向服务器。
