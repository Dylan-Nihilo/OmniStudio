#!/usr/bin/env python3
"""
One-time migration script to upload local assets to OSS.

This script scans projects.json for local asset paths and uploads them to OSS,
then updates the paths to use OSS object keys.

Usage:
    python scripts/migrate_assets_to_oss.py
"""

import os
import sys
import json

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load environment variables from .env
from dotenv import load_dotenv
load_dotenv()

from src.utils.oss_utils import OSSImageUploader



def is_migratable_path(value: str, uploader) -> bool:
    """Check if a value should be migrated to OSS."""
    if not value or not isinstance(value, str):
        return False
    if value.startswith(("http://", "https://", "blob:", "data:")):
        return False
    
    # Case 1: Explicit local path
    local_prefixes = (
        "assets/", "storyboard/", "video/", "audio/", "export/", "uploads/",
        "outputs/videos/",  # Legacy plural path
    )
    if value.startswith(local_prefixes):
        return True
        
    # Case 2: Already has OSS prefix but might be missing from OSS
    base_path = os.getenv('OSS_BASE_PATH', 'omni_studio').strip("'\"/")
    if value.startswith(f"{base_path}/"):
        if not uploader.object_exists(value):
            print(f"  ! Missing from OSS: {value}")
            return True
            
    return False


def migrate_value(value, uploader, output_dir, stats):
    """Migrate a single value if it's a migratable path."""
    if isinstance(value, str):
        if is_migratable_path(value, uploader):
            # Determine local path
            base_path = os.getenv('OSS_BASE_PATH', 'omni_studio').strip("'\"/")
            
            if value.startswith(f"{base_path}/"):
                # Convert OSS key back to local path for upload
                # e.g., omni_studio/assets/characters/foo.png -> output/assets/characters/foo.png
                local_rel_path = value[len(base_path)+1:]
                local_path = os.path.join(output_dir, local_rel_path)
            else:
                # Normalize path (handle outputs/ vs output/)
                normalized_path = value
                if normalized_path.startswith("outputs/"):
                    normalized_path = normalized_path.replace("outputs/", "output/", 1)
                
                if normalized_path.startswith("output/"):
                    local_path = normalized_path
                else:
                    local_path = os.path.join(output_dir, value)
            
            if os.path.exists(local_path):
                # Determine sub_path based on asset type
                if "characters" in local_path:
                    sub_path = "assets/characters"
                elif "scenes" in local_path:
                    sub_path = "assets/scenes"
                elif "props" in local_path:
                    sub_path = "assets/props"
                elif "storyboard" in local_path:
                    sub_path = "storyboard"
                elif "video" in local_path:
                    sub_path = "videos"
                else:
                    sub_path = "misc"
                
                try:
                    # Use the filename from the local path
                    filename = os.path.basename(local_path)
                    object_key = uploader.upload_file(local_path, sub_path=sub_path, custom_filename=filename)
                    if object_key:
                        stats["uploaded"] += 1
                        print(f"  ✓ Uploaded: {local_path} -> {object_key}")
                        return object_key
                    else:
                        stats["failed"] += 1
                        print(f"  ✗ Upload failed: {local_path}")
                except Exception as e:
                    stats["failed"] += 1
                    print(f"  ✗ Error uploading {local_path}: {e}")
            else:
                stats["not_found"] += 1
                print(f"  ⚠ Local file not found: {local_path}")
        return value
    elif isinstance(value, dict):
        return {k: migrate_value(v, uploader, output_dir, stats) for k, v in value.items()}
    elif isinstance(value, list):
        return [migrate_value(item, uploader, output_dir, stats) for item in value]
    else:
        return value



def main():
    print("=" * 60)
    print("Legacy Asset Migration to OSS")
    print("=" * 60)
    
    # Initialize uploader
    uploader = OSSImageUploader()
    if not uploader.is_configured:
        print("ERROR: OSS is not configured. Please set environment variables.")
        sys.exit(1)
    
    print(f"OSS Bucket: {uploader.bucket.bucket_name if uploader.bucket else 'N/A'}")
    base_path = os.getenv('OSS_BASE_PATH', 'omni_studio').strip("'\"/")
    print(f"Base Path: {base_path}")

    
    # Load projects.json
    output_dir = "output"
    projects_path = os.path.join(output_dir, "projects.json")
    
    if not os.path.exists(projects_path):
        print(f"ERROR: {projects_path} not found.")
        sys.exit(1)
    
    with open(projects_path, "r") as f:
        projects = json.load(f)
    
    print(f"\nFound {len(projects)} projects to process.\n")
    
    # Stats
    stats = {"uploaded": 0, "failed": 0, "not_found": 0, "skipped": 0}
    
    # Migrate each project
    for project_id, project_data in projects.items():
        print(f"Processing project: {project_data.get('title', project_id)}")
        projects[project_id] = migrate_value(project_data, uploader, output_dir, stats)
    
    # Save updated projects.json
    backup_path = projects_path + ".backup"
    os.rename(projects_path, backup_path)
    print(f"\n✓ Backed up original to {backup_path}")
    
    with open(projects_path, "w") as f:
        json.dump(projects, f, indent=2, ensure_ascii=False)
    print(f"✓ Saved updated {projects_path}")
    
    # Summary
    print("\n" + "=" * 60)
    print("Migration Summary")
    print("=" * 60)
    print(f"  Uploaded:   {stats['uploaded']}")
    print(f"  Failed:     {stats['failed']}")
    print(f"  Not Found:  {stats['not_found']}")
    print(f"  Skipped:    {stats['skipped']}")
    print("=" * 60)
    print("\nDone! Please restart the backend and refresh the frontend.")


if __name__ == "__main__":
    main()
