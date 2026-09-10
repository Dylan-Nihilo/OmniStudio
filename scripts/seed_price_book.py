"""Load config/pricing/price_book.seed.json into the pricing draft and optionally publish it.

    python scripts/seed_price_book.py            # upsert draft items + rule (idempotent)
    python scripts/seed_price_book.py --publish  # ...and publish as a new price book version

Only meant for first-time setup; afterwards root edits prices in the admin console.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.billing import BillingServices  # noqa: E402
from src.storage.db import create_engine, init_schema  # noqa: E402

SEED = Path(__file__).resolve().parents[1] / "config" / "pricing" / "price_book.seed.json"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--seed", default=str(SEED))
    args = parser.parse_args(argv)

    seed = json.loads(Path(args.seed).read_text(encoding="utf-8"))
    engine = create_engine()
    init_schema(engine)
    billing = BillingServices.build(engine)
    billing.price_admin.update_rule(None, **seed["rule"])
    for item in seed["items"]:
        billing.price_admin.upsert_item(None, **item)
    print(f"draft: {len(seed['items'])} items, rule {billing.price_admin.get_rule().to_dict()}")
    if args.publish:
        result = billing.price_admin.publish(None, note="seed")
        print(f"published version {result.version} ({result.item_count} items)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
