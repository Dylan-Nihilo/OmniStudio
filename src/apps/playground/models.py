from typing import List, Optional
from enum import Enum
from pydantic import BaseModel, Field


class PlaygroundMode(str, Enum):
    T2I = "t2i"
    I2I = "i2i"
    T2V = "t2v"
    I2V = "i2v"
    R2V = "r2v"
    V2V = "v2v"


class PlaygroundOutput(BaseModel):
    id: str = Field(..., description="Unique identifier (UUID)")
    media_path: str = Field(..., description="Generated file path relative to output/")
    media_type: str = Field(..., description="Output media type: image or video")
    thumbnail_path: Optional[str] = Field(None, description="Thumbnail file path relative to output/")
    saved_to_library: bool = Field(False, description="Whether this output has been saved to the project library")


class PlaygroundGeneration(BaseModel):
    id: str = Field(..., description="Unique identifier (UUID)")
    workspace_id: Optional[str] = Field(None, description="Owning Workspace ID")
    mode: PlaygroundMode = Field(..., description="Generation mode")
    model_id: str = Field(..., description="Model identifier from model catalog")
    prompt: str = Field(..., description="Text prompt for generation")
    negative_prompt: Optional[str] = Field(None, description="Negative prompt to exclude undesired elements")
    input_media: List[str] = Field(default_factory=list, description="Input file paths for image/video-conditioned modes")
    parameters: dict = Field(default_factory=dict, description="Generation parameters (resolution, duration, aspect_ratio, etc.)")
    batch_size: int = Field(1, ge=1, le=4, description="Number of outputs to generate per request (1-4)")
    outputs: List[PlaygroundOutput] = Field(default_factory=list, description="Generated outputs")
    status: str = Field("pending", description="Generation status: pending/processing/completed/failed")
    error: Optional[str] = Field(None, description="Error message if generation failed")
    created_at: str = Field(..., description="Creation timestamp in ISO 8601 format")


class PlaygroundTemplate(BaseModel):
    id: str = Field(..., description="Unique identifier (UUID)")
    workspace_id: Optional[str] = Field(None, description="Owning Workspace ID")
    name: str = Field(..., description="Template display name")
    category: str = Field("general", description="Template category: image/video/general")
    prompt: str = Field(..., description="Template prompt text")
    negative_prompt: Optional[str] = Field(None, description="Default negative prompt")
    default_mode: Optional[PlaygroundMode] = Field(None, description="Default generation mode for this template")
    default_model_id: Optional[str] = Field(None, description="Default model identifier")
    default_parameters: dict = Field(default_factory=dict, description="Default generation parameters")
    created_at: str = Field(..., description="Creation timestamp in ISO 8601 format")
    updated_at: str = Field(..., description="Last update timestamp in ISO 8601 format")


class GenerateRequest(BaseModel):
    mode: PlaygroundMode = Field(..., description="Generation mode")
    model_id: str = Field(..., description="Model identifier from model catalog")
    prompt: str = Field(..., description="Text prompt for generation")
    negative_prompt: Optional[str] = Field(None, description="Negative prompt to exclude undesired elements")
    input_media: Optional[List[str]] = Field(None, description="Input file paths for image/video-conditioned modes")
    parameters: Optional[dict] = Field(None, description="Generation parameters (resolution, duration, aspect_ratio, etc.)")
    batch_size: Optional[int] = Field(1, ge=1, le=4, description="Number of outputs to generate (1-4)")


class SaveToLibraryRequest(BaseModel):
    category: str = Field("general", description="Library category for the saved output")


class CreateTemplateRequest(BaseModel):
    name: str = Field(..., description="Template display name")
    category: Optional[str] = Field("general", description="Template category: image/video/general")
    prompt: str = Field(..., description="Template prompt text")
    negative_prompt: Optional[str] = Field(None, description="Default negative prompt")
    default_mode: Optional[PlaygroundMode] = Field(None, description="Default generation mode")
    default_model_id: Optional[str] = Field(None, description="Default model identifier")
    default_parameters: Optional[dict] = Field(None, description="Default generation parameters")


class UpdateTemplateRequest(BaseModel):
    name: Optional[str] = Field(None, description="Template display name")
    category: Optional[str] = Field(None, description="Template category: image/video/general")
    prompt: Optional[str] = Field(None, description="Template prompt text")
    negative_prompt: Optional[str] = Field(None, description="Default negative prompt")
    default_mode: Optional[PlaygroundMode] = Field(None, description="Default generation mode")
    default_model_id: Optional[str] = Field(None, description="Default model identifier")
    default_parameters: Optional[dict] = Field(None, description="Default generation parameters")
