"""Grant or revoke a platform role (root / admin / reseller_admin) for an existing user.

Fresh installs make the setup user root automatically; deployments that predate billing
use this once to appoint the first root:

    python scripts/grant_platform_role.py --username <name> --role root
    python scripts/grant_platform_role.py --username <name> --revoke
    python scripts/grant_platform_role.py --list

The storage URL comes from OMNI_STUDIO_DATABASE_URL (or the default SQLite file).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.billing.roles import ROLES, RoleService  # noqa: E402
from src.storage.auth_repository import AuthRepository  # noqa: E402
from src.storage.db import create_engine, init_schema  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--username")
    parser.add_argument("--role", choices=ROLES)
    parser.add_argument("--revoke", action="store_true")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args(argv)

    engine = create_engine()
    init_schema(engine)
    roles = RoleService(engine)
    if args.list:
        for row in roles.list_roles():
            print(f"{row['role']:15} {row['user_id']}")
        return 0
    if not args.username or not (args.role or args.revoke):
        parser.error("--username with --role or --revoke is required")
    user = AuthRepository(engine).find_user_by_username(args.username.strip().lower())
    if user is None:
        print(f"user {args.username!r} not found", file=sys.stderr)
        return 1
    if args.revoke:
        roles.revoke(user.id)
        print(f"revoked platform role from {user.username} ({user.id})")
    else:
        roles.grant(user.id, args.role, by_user_id=None)
        print(f"granted {args.role} to {user.username} ({user.id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
