# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Git Commit Rules

- Git author is already configured for this repo, do not modify git config
- **NEVER** add `Co-Authored-By` lines in commit messages
- Push to GitHub remote (`github`) only, ignore `origin` (deprecated GitLab)

## Project Workflow Triggers

When the user asks to do any of the following in this repository:

- publish to the LumenX GitHub mirror
- run the LumenX GitHub publish workflow
- follow the LumenX GitHub release or PR flow
- prepare a GitHub-safe branch, commit, push, or PR for LumenX
- use `/lumenx-git-publish`

Treat that as a request to load and follow:

`.codex/workflows/lumenx-git-publish.md`

When the user asks to do any of the following in this repository:

- onboard a new model into LumenX
- update model docs, model versions, defaults, or parameters
- refresh Wan / Kling / Vidu / PixVerse model support
- run the LumenX model onboarding workflow
- review whether a model change is catalog-only or also needs runtime / UI work
- use `/lumenx-model-onboarding`

Treat that as a request to load and follow:

`.codex/workflows/lumenx-model-onboarding.md`

When the user asks to do any of the following in this repository:

- build the LumenX desktop app
- package LumenX Studio for macOS or Windows
- create a DMG or EXE build
- run the LumenX desktop build workflow
- use `/lumenx-build`

Treat that as a request to load and follow:

`.codex/workflows/lumenx-build.md`

This repository does not rely on native slash commands in Codex. The strings `/lumenx-git-publish`, `/lumenx-build`, and `/lumenx-model-onboarding` are textual aliases for the workflows above.

## Workflow Files

- `.claude/commands/lumenx-git-publish.md` remains the Claude project command source.
- `.claude/commands/lumenx-build.md` remains the Claude project command source.
- `.claude/commands/lumenx-model-onboarding.md` remains the Claude project command source.
- `.codex/workflows/lumenx-git-publish.md` is the Codex workflow mirror for the same project process.
- `.codex/workflows/lumenx-build.md` is the Codex workflow mirror for the desktop build process.
- `.codex/workflows/lumenx-model-onboarding.md` is the Codex workflow mirror for model onboarding, catalog updates, and verification.

If both Claude and Codex guidance exist, preserve behavior parity unless the user asks for divergence.

After editing any file in `.claude/commands/` or `.codex/workflows/`, run `python3 scripts/check_workflow_parity.py` to verify mirror parity. Record intentional divergences with reasons in the script's `WAIVERS` table.

# AI Comic Generator Platform

## Overview

The AI Comic Generator is a complete AI-powered comic video production platform that supports the full workflow from script to finished video. It uses Next.js frontend with FastAPI backend, integrating AI services like Qwen from Alibaba Cloud.

## Architecture

### Frontend
- Framework: Next.js 14 + React 18 + TypeScript + Tailwind CSS
- State management: Zustand
- HTTP client: Axios
- 3D rendering: Three.js + @react-three/fiber
- Animation: Framer Motion

### Backend
- Framework: FastAPI (Python 3.11+)
- AI integration: Alibaba Cloud Qwen/Wanx services via DashScope
- Data validation: Pydantic
- File storage: Local + Alibaba Cloud OSS

### Core Components

#### Frontend Structure
```
frontend/
├── src/app/              # Next.js App Router pages
├── src/components/       # React components
│   ├── layout/          # Layout components
│   ├── modules/         # Feature modules (ScriptInput, ArtDirection, etc.)
│   ├── canvas/          # Canvas-related components
│   └── project/         # Project-specific components
├── src/lib/             # Utilities (API client at api.ts)
└── src/store/           # Zustand stores
```

#### Backend Structure
```
src/
├── apps/comic_gen/      # Core comic generation logic
│   ├── api.py           # FastAPI routes (main entry point)
│   ├── pipeline.py      # Core business flow management
│   ├── models.py        # Data models (Pydantic)
│   ├── llm.py           # LLM interaction (script analysis, etc.)
│   ├── assets.py        # Asset generation (characters/scenes/props)
│   ├── storyboard.py    # Storyboard generation
│   ├── video.py         # Video generation
│   ├── audio.py         # Audio generation
│   └── export.py        # Video export/synthesis
├── models/              # AI model wrappers
├── utils/               # Utility functions (OSS integration)
└── config.py            # Global configuration
```

## Development Commands

### Initial Setup
```bash
# Copy environment template
cp .env.example .env
# Edit .env and add your Alibaba Cloud API keys
```

### Backend Development
```bash
# Install dependencies
pip install -r requirements.txt

# Create output directories
mkdir -p output/uploads

# Start backend server
./start_backend.sh
# or
python -m uvicorn src.apps.comic_gen.api:app --reload --host 0.0.0.0 --port 17177

# API docs available at: http://localhost:17177/docs
```

### Frontend Development
```bash
cd frontend
npm install
npm run dev
# Frontend available at: http://localhost:3008
```

### Verification Commands
Keep in sync with the same section in `CLAUDE.md`.

Frontend verification commands:
```bash
cd frontend
npm run typecheck
npm run test
npm run test:ui
npm run test:all
npm run build
```

Backend/catalog verification commands:
```bash
pytest -q
python scripts/build_model_catalog.py
python scripts/validate_model_catalog.py
```

### Full Development Mode
```bash
# Terminal 1: Start backend
./start_backend.sh

# Terminal 2: Start frontend
cd frontend && npm run dev
```

### Desktop App Mode
```bash
# Run the complete desktop application
python main.py
```

## File Structure

### Output Management
Generated files are stored in `output/`:
```
output/
├── assets/              # Character/scene/prop images
│   ├── characters/      # Character artwork
│   ├── scenes/          # Scene backgrounds
│   └── props/           # Prop items
├── storyboard/          # Storyboard renders
├── outputs/videos/      # Individual video segments
├── video/               # Final merged videos
├── uploads/             # User-uploaded files
└── video_inputs/        # Video generation source images
```

### Project Data
Development project data is stored in this repository under `output/`:
- `output/projects.json` - Studio main project database
- `output/series.json` - Studio series database
- `output/atelier_projects.json` - Atelier canvas/node/agent-turn persistence (independent of Studio)
- generated media under `output/assets/`, `output/storyboard/`, `output/video/`, and `output/uploads/`

Packaged desktop app configuration and logs are stored under `~/.lumen-x/`:
- `~/.lumen-x/config.json` - App settings, API keys, and OSS configuration
- `~/.lumen-x/logs/app.log` - Desktop app log file

## Key API Endpoints

### Project Management
- `POST /projects` - Create new project from script text
- `GET /projects` - List all projects
- `GET /projects/{id}` - Get project details
- `DELETE /projects/{id}` - Delete project
- `PUT /projects/{id}/reparse` - Reprocess script for project

### Asset Generation
- `POST /projects/{id}/generate_assets` - Generate all project assets
- `POST /projects/{id}/assets/generate` - Generate specific asset
- `POST /projects/{id}/assets/toggle_lock` - Lock/unlock asset
- `POST /projects/{id}/assets/update_image` - Update asset image

### Storyboard & Video
- `POST /projects/{id}/generate_storyboard` - Generate storyboards
- `POST /projects/{id}/storyboard/render` - Render specific frame
- `POST /projects/{id}/generate_video` - Generate videos from storyboards
- `POST /projects/{id}/video_tasks` - Create video generation tasks
- `POST /projects/{id}/merge` - Merge video segments

### Art Direction
- `POST /projects/{id}/art_direction/analyze` - Analyze script for style
- `POST /projects/{id}/art_direction/save` - Save art direction
- `GET /art_direction/presets` - Get style presets

## Development Guidelines

### Backend Changes
- Update Pydantic models in `src/apps/comic_gen/models.py` when modifying data structures
- Add new endpoints to `src/apps/comic_gen/api.py` using FastAPI conventions
- Implement business logic in appropriate modules in `pipeline.py`
- Use background tasks for AI processing operations

### Frontend Changes
- Add new API calls to `frontend/src/lib/api.ts`
- Create feature modules in `frontend/src/components/modules/`
- Use Zustand stores for shared state management
- Follow existing component structure patterns

### Configuration
- API keys can be configured via `.env` file or app settings dialog
- OSS configuration is optional but recommended for cloud storage
- Model settings can be changed per project via `update_model_settings`

## Debugging

### Common Issues
- FFmpeg not found: Install FFmpeg and ensure it's in PATH
- API keys missing: Configure via app settings or .env file
- OSS errors: Verify credentials and bucket permissions
- Video merge failures: Check if video files exist and have proper paths

### Logs
- Backend logs appear in terminal when running start_backend.sh
- Desktop app logs saved to: `~/.lumen-x/logs/app.log`

## Deployment
- Frontend: Built with Next.js, can be deployed as static files
- Backend: Deploy with FastAPI server (Gunicorn recommended for production)
- Desktop app: Built with PyInstaller and pywebview

## Design Context

### Users
Primary: independent creators (self-media, short-video makers) who need to turn text scripts into comic-style videos quickly. Secondary: professional teams using it as a pre-production tool. Both share a need for speed and creative control — they think in stories, not in software.

### Brand Personality
**Creative · Immersive · Geeky** — LumenX feels like a creator's cockpit, not an admin panel. It respects the user's craft while putting AI power at their fingertips. The tagline "Render Noise into Narrative" captures the mission: raw ideas in, polished stories out.

### Aesthetic Direction
- **Dark-first**: Deep space black (#050508) background, no light mode. The darkness lets content (images, videos, storyboards) be the hero.
- **Glassmorphism**: Frosted glass panels (5% white + backdrop-blur) for structure. Layered transparency creates depth without clutter.
- **Neon accents**: Electric blue (#646cff) primary, hot pink (#ff0080) accent. Used sparingly for interactive elements and emphasis — not decoration.
- **Brand gradient**: Purple → Indigo → Pink (the "X" in LumenX). Reserved for branding moments, not sprinkled everywhere.
- **Typography**: Space Grotesk (display/headings — geometric, modern), Inter (body — clean, readable), JetBrains Mono (code/technical values).
- **Anti-references**: No dense tables/forms that feel like enterprise admin. No excessive particles/animations that distract from content. No multi-panel professional tool complexity (not Figma/Photoshop).

### Design Principles

1. **Content is king**: The user's creations (scripts, storyboards, videos, assets) should always be the visual focus. UI chrome stays quiet until needed.
2. **Progressive disclosure**: Show only what matters at each step. Advanced settings (prompt config, model settings) are accessible but not in-your-face. Use collapsible sections and contextual reveals.
3. **Confidence through feedback**: Every action should have clear, immediate visual feedback — loading states, success confirmations, smooth transitions. The user should always know what's happening and feel in control.
4. **Consistent glass language**: All containers use the glass-panel pattern. Inputs use glass-input. Buttons use glass-button or primary fills. No mixing of visual metaphors.
5. **Purposeful motion**: Framer Motion for meaningful transitions (enter/exit, state changes). Staggered reveals for lists. No gratuitous animation — every movement communicates something.
