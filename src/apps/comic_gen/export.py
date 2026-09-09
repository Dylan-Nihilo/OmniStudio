import os
from typing import Dict, Any, Callable, Optional
from .models import Script
from ...utils import get_logger

logger = get_logger(__name__)

class ExportManager:
    """Compatibility facade for callers that still use the legacy export API."""

    def __init__(
        self,
        config: Dict[str, Any] = None,
        render_callback: Optional[Callable[[Script, Dict[str, Any]], str]] = None,
    ):
        self.config = config or {}
        self.output_dir = self.config.get('output_dir', 'output/export')
        self.render_callback = render_callback
        os.makedirs(self.output_dir, exist_ok=True)

    def render_project(self, script: Script, options: Dict[str, Any]) -> str:
        """
        Renders the final video for the project.
        Returns the relative URL of the exported file.
        """
        logger.info(f"Starting export for project {script.id} with options: {options}")
        
        if self.render_callback is None:
            raise RuntimeError("ExportManager requires a durable merge callback")
        return self.render_callback(script, dict(options or {}))
