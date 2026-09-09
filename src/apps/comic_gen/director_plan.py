"""Layered Director Plan contracts and persistence for Studio prompts."""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select
from sqlalchemy.engine import Engine

from ...storage.schema import DirectorPlan as DirectorPlanRow, Episode

PlanScope = Literal["project", "episode", "shot"]


class DirectorPlanPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tempo: str | None = Field(default=None, min_length=1, max_length=120)
    composition: str | None = Field(default=None, min_length=1, max_length=240)
    lens: str | None = Field(default=None, min_length=1, max_length=80)
    blocking: str | None = Field(default=None, min_length=1, max_length=500)
    lighting: str | None = Field(default=None, min_length=1, max_length=500)
    transition: str | None = Field(default=None, min_length=1, max_length=160)
    sound: str | None = Field(default=None, min_length=1, max_length=500)
    continuity_rules: list[str] | None = Field(default=None, max_length=20)
    episode_id: str | None = Field(default=None, min_length=1, max_length=200)


class DirectorPlanValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tempo: str = "balanced"
    composition: str = "natural"
    lens: str = "35mm"
    blocking: str = "clear subject separation"
    lighting: str = "motivated soft light"
    transition: str = "cut"
    sound: str = "diegetic room tone"
    continuity_rules: list[str] = Field(default_factory=list)


@dataclass(frozen=True)
class DirectorPlanRecord:
    id: str
    workspace_id: str
    scope: PlanScope
    scope_id: str
    project_id: str | None
    episode_id: str | None
    shot_id: str | None
    payload: dict[str, Any]
    created_at: float
    updated_at: float


class DirectorPlanStore:
    def __init__(self, engine: Engine):
        self.engine = engine

    @staticmethod
    def _payload(row: Any) -> dict[str, Any]:
        return json.loads(str(row["payload_json"])) if row else {}

    def get(self, workspace_id: str, scope: PlanScope, scope_id: str) -> DirectorPlanRecord | None:
        with self.engine.connect() as connection:
            row = connection.execute(
                select(DirectorPlanRow.__table__).where(
                    DirectorPlanRow.workspace_id == workspace_id,
                    DirectorPlanRow.scope == scope,
                    DirectorPlanRow.scope_id == scope_id,
                )
            ).mappings().first()
        if row is None:
            return None
        return DirectorPlanRecord(
            id=str(row["id"]), workspace_id=str(row["workspace_id"]), scope=row["scope"],
            scope_id=str(row["scope_id"]), project_id=row["project_id"], episode_id=row["episode_id"],
            shot_id=row["shot_id"], payload=self._payload(row), created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    def upsert(
        self,
        workspace_id: str,
        scope: PlanScope,
        scope_id: str,
        payload: dict[str, Any],
        *,
        project_id: str | None = None,
        episode_id: str | None = None,
        shot_id: str | None = None,
    ) -> DirectorPlanRecord:
        now = time.time()
        clean = {key: value for key, value in payload.items() if value is not None and key != "episode_id"}
        merged = dict(clean)
        with self.engine.begin() as connection:
            existing = connection.execute(
                select(DirectorPlanRow.__table__).where(
                    DirectorPlanRow.workspace_id == workspace_id,
                    DirectorPlanRow.scope == scope,
                    DirectorPlanRow.scope_id == scope_id,
                )
            ).mappings().first()
            if existing:
                merged = {**self._payload(existing), **clean}
                connection.execute(
                    DirectorPlanRow.__table__.update()
                    .where(DirectorPlanRow.id == existing["id"])
                    .values(payload_json=json.dumps(merged, ensure_ascii=False), updated_at=now)
                )
                row_id = str(existing["id"])
                created_at = float(existing["created_at"])
            else:
                row_id = str(uuid.uuid4())
                created_at = now
                connection.execute(
                    DirectorPlanRow.__table__.insert().values(
                        id=row_id, workspace_id=workspace_id, scope=scope, scope_id=scope_id,
                        project_id=project_id, episode_id=episode_id, shot_id=shot_id,
                        payload_json=json.dumps(clean, ensure_ascii=False), created_at=now, updated_at=now,
                    )
                )
        return DirectorPlanRecord(
            id=row_id, workspace_id=workspace_id, scope=scope, scope_id=scope_id,
            project_id=project_id, episode_id=episode_id, shot_id=shot_id, payload=merged,
            created_at=created_at, updated_at=now,
        )

    def delete(self, workspace_id: str, scope: PlanScope, scope_id: str) -> bool:
        with self.engine.begin() as connection:
            result = connection.execute(
                delete(DirectorPlanRow.__table__).where(
                    DirectorPlanRow.workspace_id == workspace_id,
                    DirectorPlanRow.scope == scope,
                    DirectorPlanRow.scope_id == scope_id,
                )
            )
        return bool(result.rowcount)

    def resolve(self, workspace_id: str, episode_id: str, shot_id: str | None = None) -> dict[str, Any]:
        with self.engine.connect() as connection:
            episode = connection.execute(
                select(Episode.project_id).where(Episode.id == episode_id)
            ).scalar_one_or_none()
        project_id = str(episode or episode_id)
        layers: list[tuple[str, str]] = [("project", project_id), ("episode", episode_id)]
        if shot_id:
            layers.append(("shot", shot_id))
        plan = DirectorPlanValue().model_dump()
        source_chain = {key: "system" for key in plan}
        records: list[DirectorPlanRecord] = []
        for scope, scope_id in layers:
            record = self.get(workspace_id, scope, scope_id)  # type: ignore[arg-type]
            if record is None:
                continue
            records.append(record)
            for key, value in record.payload.items():
                if key in plan:
                    plan[key] = value
                    source_chain[key] = scope
        prompt = "Director Plan: " + "; ".join(
            f"{key}={value}" for key, value in plan.items() if key != "continuity_rules"
        )
        if plan.get("continuity_rules"):
            prompt += "; continuity_rules=" + ", ".join(plan["continuity_rules"])
        return {
            "episode_id": episode_id,
            "shot_id": shot_id,
            "plan": plan,
            "source_chain": source_chain,
            "prompt": prompt,
            "prompt_provenance": source_chain,
            "layers": [record.__dict__ for record in records],
        }


def preview_from_instruction(instruction: str) -> DirectorPlanValue:
    """Deterministic preview fallback; a model adapter can replace this later."""
    text = instruction.casefold()
    return DirectorPlanValue(
        tempo="urgent" if any(word in text for word in ("紧张", "urgent", "fast")) else "measured",
        composition="low-angle foreground separation",
        lens="24mm",
        blocking="foreground subject advances toward camera",
        lighting="cool backlight with hard rim",
        transition="match cut",
        sound="tight footsteps and restrained room tone",
        continuity_rules=["preserve eyeline", "match screen direction"],
    )


__all__ = ["DirectorPlanPatch", "DirectorPlanStore", "DirectorPlanValue", "PlanScope", "preview_from_instruction"]
