import os
import oss2
from dotenv import load_dotenv

load_dotenv()

access_key_id = os.getenv("ALIBABA_CLOUD_ACCESS_KEY_ID")
access_key_secret = os.getenv("ALIBABA_CLOUD_ACCESS_KEY_SECRET")
endpoint = os.getenv("OSS_ENDPOINT")
bucket_name = os.getenv("OSS_BUCKET_NAME")
base_path = os.getenv("OSS_BASE_PATH", "omni_studio").strip("'\"/")

auth = oss2.Auth(access_key_id, access_key_secret)
bucket = oss2.Bucket(auth, endpoint, bucket_name)

test_key = f"{base_path}/assets/characters/593da220-e315-4aac-9016-2e2b243912b1_fullbody_d452dadb-c703-419e-85c2-fc48dc75275a.png"
exists = bucket.object_exists(test_key)

print(f"Checking key: {test_key}")
print(f"Exists: {exists}")

if not exists:
    print("\nListing first 5 objects in bucket:")
    for i, obj in enumerate(oss2.ObjectIterator(bucket)):
        print(f"  {obj.key}")
        if i >= 4:
            break
