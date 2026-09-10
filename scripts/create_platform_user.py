"""Create a user with its own workspace and a platform role (root / admin / reseller_admin).

Normal signup happens through /auth/setup (first user) or an invitation. A super admin needs
neither: it is created out of band so it owns a private workspace and is not a member of
anyone else's.

    python scripts/create_platform_user.py --username superadmin --email admin@example.com \
        --role root [--password '...'] [--display-name '超级管理员']

Without --password a strong one is generated and printed once. The storage URL comes from
OMNI_STUDIO_DATABASE_URL (or the default SQLite file).
"""

from __future__ import annotations

import argparse
import secrets
import string
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.apps.comic_gen.auth.passwords import hash_password  # noqa: E402
from src.apps.comic_gen.auth.service import normalize_email, normalize_username, validate_password  # noqa: E402
from src.billing.roles import ROLES, RoleService  # noqa: E402
from src.storage.auth_repository import AuthRepository  # noqa: E402
from src.storage.db import create_engine, init_schema  # noqa: E402

ALPHABET = string.ascii_letters + string.digits + "!@#$%^&*-_"


def generate_password(length: int = 24) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--username", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--role", choices=ROLES, default="root")
    parser.add_argument("--password")
    parser.add_argument("--display-name")
    parser.add_argument("--workspace-name", default=None)
    args = parser.parse_args(argv)

    username, username_normalized = normalize_username(args.username)
    email, email_normalized = normalize_email(args.email)
    password = args.password or generate_password()
    validate_password(password, username_normalized=username_normalized, email_normalized=email_normalized)

    engine = create_engine()
    init_schema(engine)
    repository = AuthRepository(engine)
    if repository.find_user_by_username(username_normalized) is not None:
        print(f"user {username!r} already exists", file=sys.stderr)
        return 1
    if repository.find_user_by_email(email_normalized) is not None:
        print(f"email {email!r} already in use", file=sys.stderr)
        return 1

    now = time.time()
    user = repository.create_user({
        "id": str(uuid.uuid4()),
        "username": username,
        "username_normalized": username_normalized,
        "email": email,
        "email_normalized": email_normalized,
        "display_name": args.display_name or username,
        "password_hash": hash_password(password),
        "created_at": now,
        "updated_at": now,
    })
    workspace = repository.create_owned_workspace(
        user_id=user.id,
        name=args.workspace_name or f"{args.display_name or username} 的工作区",
        # Login resolves the landing workspace by owner + slug "default"; anything else
        # leaves the account unable to sign in. Slugs are unique per owner, not globally.
        slug="default",
        now=now,
    )
    RoleService(engine).grant(user.id, args.role, by_user_id=None)

    print(f"created {username} ({user.id}) with platform role {args.role}")
    print(f"workspace: {workspace.workspace.name} ({workspace.workspace.id})")
    if not args.password:
        print(f"password: {password}")
        print("Store it now; it is not recoverable from the database.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
