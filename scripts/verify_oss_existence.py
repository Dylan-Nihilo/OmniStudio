import os
import json
import oss2
from dotenv import load_dotenv

# Add project root to path
import sys
sys.path.insert(0, os.getcwd())

from src.utils.oss_utils import OSSImageUploader

load_dotenv()

uploader = OSSImageUploader()
if not uploader.is_configured:
    print("OSS not configured")
    sys.exit(1)

print(f"Checking OSS for objects in projects.json...")

with open("output/projects.json", "r") as f:
    projects = json.load(f)

count = 0
exists_count = 0
missing_count = 0

def check_value(val):
    global count, exists_count, missing_count
    if isinstance(val, str) and val.startswith("omni_studio/"):
        count += 1
        if uploader.object_exists(val):
            exists_count += 1
        else:
            missing_count += 1
            print(f"Missing on OSS: {val}")
    elif isinstance(val, dict):
        for v in val.values():
            check_value(v)
    elif isinstance(val, list):
        for v in val:
            check_value(v)

for pid, pdata in projects.items():
    check_value(pdata)

print(f"\nSummary:")
print(f"Total checked: {count}")
print(f"Exists on OSS: {exists_count}")
print(f"Missing on OSS: {missing_count}")
