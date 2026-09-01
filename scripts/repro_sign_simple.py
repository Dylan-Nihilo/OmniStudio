import os
import json
from dotenv import load_dotenv

# Add project root to path
import sys
sys.path.insert(0, os.getcwd())

from src.utils.oss_utils import is_object_key, get_oss_base_path

load_dotenv()

print(f"OSS_BASE_PATH from env: {os.getenv('OSS_BASE_PATH')}")
print(f"get_oss_base_path(): {get_oss_base_path()}")

test_value = "omni_studio/assets/characters/593da220-e315-4aac-9016-2e2b243912b1_fullbody_d452dadb-c703-419e-85c2-fc48dc75275a.png"

print(f"\nTesting value: {test_value}")
is_ok = is_object_key(test_value)
print(f"is_object_key: {is_ok}")

# Mock uploader to see what it would sign
class MockUploader:
    def __init__(self):
        self.is_configured = True
    def sign_url_for_display(self, key):
        print(f"MOCK: Signing key: {key}")
        return f"http://signed-url/{key}"

from src.utils.oss_utils import sign_oss_urls_in_data

mock_uploader = MockUploader()
data = {"url": test_value}
signed_data = sign_oss_urls_in_data(data, mock_uploader)
print(f"Signed data: {signed_data}")
