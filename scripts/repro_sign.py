import os
import json
from dotenv import load_dotenv

# Add project root to path
import sys
sys.path.insert(0, os.getcwd())

from src.utils.oss_utils import is_object_key, OSSImageUploader, get_oss_base_path

load_dotenv()

print(f"OSS_BASE_PATH from env: {os.getenv('OSS_BASE_PATH')}")
print(f"get_oss_base_path(): {get_oss_base_path()}")

test_values = [
    "omni_studio/assets/characters/593da220-e315-4aac-9016-2e2b243912b1_fullbody_d452dadb-c703-419e-85c2-fc48dc75275a.png",
    "assets/characters/593da220-e315-4aac-9016-2e2b243912b1_fullbody_d452dadb-c703-419e-85c2-fc48dc75275a.png",
    "/files/assets/characters/161b6d70-50a9-4a48-a18c-80a30469670a.png"
]

uploader = OSSImageUploader()

for val in test_values:
    is_ok = is_object_key(val)
    print(f"\nValue: {val}")
    print(f"is_object_key: {is_ok}")
    if is_ok:
        signed = uploader.sign_url_for_display(val)
        print(f"Signed URL: {signed}")

# Check projects.json
print("\nChecking projects.json for the specific key...")
with open("output/projects.json", "r") as f:
    projects = json.load(f)

found = False
for pid, pdata in projects.items():
    if "full_body_image_url" in pdata:
        url = pdata["full_body_image_url"]
        if "593da220-e315-4aac-9016-2e2b243912b1" in str(url):
            print(f"Found in project {pid}: {url}")
            found = True
            is_ok = is_object_key(url)
            print(f"  is_object_key: {is_ok}")
            if is_ok:
                print(f"  Signed: {uploader.sign_url_for_display(url)}")

if not found:
    print("Not found in projects.json")
