"""Playground storage layer — JSON-file persistence for generation history and templates."""

import json
import os
import threading
from typing import List, Optional

from .models import PlaygroundGeneration, PlaygroundTemplate
from ...utils import get_logger

logger = get_logger(__name__)


class PlaygroundStorage:
    HISTORY_PATH = "output/playground_history.json"
    TEMPLATES_PATH = "output/playground_templates.json"

    def __init__(self):
        self._history: List[PlaygroundGeneration] = []
        self._templates: List[PlaygroundTemplate] = []
        self._lock = threading.RLock()
        self._load()

    # ------------------------------------------------------------------
    # Internal persistence
    # ------------------------------------------------------------------

    def _load(self) -> None:
        """Load both JSON files, creating them if missing."""
        self._history = self._load_file(self.HISTORY_PATH, PlaygroundGeneration)
        self._templates = self._load_file(self.TEMPLATES_PATH, PlaygroundTemplate)

    @staticmethod
    def _load_file(path: str, model_cls):
        """Read a JSON array file and parse each element into *model_cls*."""
        if not os.path.exists(path):
            return []
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            return [model_cls.model_validate(item) for item in raw]
        except Exception as e:
            logger.error("Failed to load %s: %s", path, e)
            return []

    def _save_history(self) -> None:
        self._save_file(self.HISTORY_PATH, self._history)

    def _save_templates(self) -> None:
        self._save_file(self.TEMPLATES_PATH, self._templates)

    def _save_file(self, path: str, items: list) -> None:
        with self._lock:
            try:
                os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(
                        [item.model_dump() for item in items],
                        f,
                        indent=2,
                        ensure_ascii=False,
                    )
            except Exception as e:
                logger.error("Failed to save %s: %s", path, e)

    # ------------------------------------------------------------------
    # History CRUD
    # ------------------------------------------------------------------

    def add_generation(self, gen: PlaygroundGeneration) -> None:
        """Append a generation record and persist."""
        with self._lock:
            self._history.append(gen)
            self._save_history()

    def get_generation(
        self,
        gen_id: str,
        workspace_id: str | None = None,
    ) -> Optional[PlaygroundGeneration]:
        """Look up a generation by its id."""
        with self._lock:
            for gen in self._history:
                if gen.id == gen_id and (workspace_id is None or gen.workspace_id == workspace_id):
                    return gen.model_copy(deep=True)
        return None

    def list_history(
        self,
        limit: int | None = 50,
        offset: int = 0,
        workspace_id: str | None = None,
    ) -> List[PlaygroundGeneration]:
        """Return paginated history, newest first."""
        with self._lock:
            ordered = [
                generation.model_copy(deep=True)
                for generation in reversed(self._history)
                if workspace_id is None or generation.workspace_id == workspace_id
            ]
            return ordered[offset:] if limit is None else ordered[offset : offset + limit]

    def update_generation(self, gen: PlaygroundGeneration) -> None:
        """Replace an existing generation record (matched by id) and persist."""
        with self._lock:
            for i, existing in enumerate(self._history):
                if existing.id == gen.id:
                    self._history[i] = gen
                    self._save_history()
                    return
        logger.warning("update_generation: id %s not found", gen.id)

    def delete_generation(self, gen_id: str, workspace_id: str | None = None) -> bool:
        """Remove a generation by id. Returns True if found and deleted."""
        with self._lock:
            for i, gen in enumerate(self._history):
                if gen.id == gen_id and (workspace_id is None or gen.workspace_id == workspace_id):
                    self._history.pop(i)
                    self._save_history()
                    return True
        return False

    # ------------------------------------------------------------------
    # Template CRUD
    # ------------------------------------------------------------------

    def add_template(self, template: PlaygroundTemplate) -> None:
        """Append a template record and persist."""
        with self._lock:
            self._templates.append(template)
            self._save_templates()

    def get_template(
        self,
        template_id: str,
        workspace_id: str | None = None,
    ) -> Optional[PlaygroundTemplate]:
        """Look up a template by its id."""
        with self._lock:
            for t in self._templates:
                if t.id == template_id and (workspace_id is None or t.workspace_id == workspace_id):
                    return t.model_copy(deep=True)
        return None

    def list_templates(self, workspace_id: str | None = None) -> List[PlaygroundTemplate]:
        """Return all templates."""
        with self._lock:
            return [
                template.model_copy(deep=True)
                for template in self._templates
                if workspace_id is None or template.workspace_id == workspace_id
            ]

    def update_template(self, template: PlaygroundTemplate) -> None:
        """Replace an existing template (matched by id) and persist."""
        with self._lock:
            for i, existing in enumerate(self._templates):
                if existing.id == template.id:
                    self._templates[i] = template
                    self._save_templates()
                    return
        logger.warning("update_template: id %s not found", template.id)

    def delete_template(self, template_id: str, workspace_id: str | None = None) -> bool:
        """Remove a template by id. Returns True if found and deleted."""
        with self._lock:
            for i, t in enumerate(self._templates):
                if t.id == template_id and (workspace_id is None or t.workspace_id == workspace_id):
                    self._templates.pop(i)
                    self._save_templates()
                    return True
        return False

    def claim_unscoped(self, workspace_id: str) -> int:
        """Assign pre-Workspace history and templates to the legacy Owner Workspace."""
        with self._lock:
            history = [item for item in self._history if item.workspace_id is None]
            templates = [item for item in self._templates if item.workspace_id is None]
            for item in history:
                item.workspace_id = workspace_id
            for item in templates:
                item.workspace_id = workspace_id
            if history:
                self._save_history()
            if templates:
                self._save_templates()
            return len(history) + len(templates)
