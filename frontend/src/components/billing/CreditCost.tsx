"use client";

import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { useTranslations } from "next-intl";
import clsx from "clsx";

import { billingApi } from "@/lib/billing";
import { creditRange, creditsFor, useBillingStore, usePricingTable } from "@/store/billingStore";
import styles from "./CreditCost.module.css";

interface CreditCostProps {
    modelId: string | null | undefined;
    /** Spec the price item matches on: resolution / mode / audio / size_tier / quality. */
    params?: Record<string, unknown>;
    /** Seconds for video, images for image models, thousands of characters for text and voice. */
    quantity?: number;
    /** Ask the server instead of reading the cached table (use when the spec is unusual). */
    exact?: boolean;
}

/**
 * "消耗 N 积分" next to a generate button. The cached pricing table answers instantly for
 * the common cases; `exact` falls back to `POST /billing/quote` so the number shown is the
 * number the server will freeze.
 */
export default function CreditCost({ modelId, params = {}, quantity = 1, exact = false }: CreditCostProps) {
    const t = useTranslations("billing");
    const enabled = useBillingStore((state) => state.enabled);
    // Rates are shown as soon as they are published; the deduction is a separate switch.
    // Showing them first is deliberate — it lets the operator check every price in the real
    // UI and gives users a stretch where the cost is visible before it is taken.
    const ratesPublished = useBillingStore((state) => state.ratesPublished);
    const visible = Boolean(enabled) || ratesPublished;
    // The hook fetches the table as well as subscribing to it, which is what every rate
    // label on the page depends on — that fetch used to live only in this component, so a
    // screen without a cost badge had no rates at all.
    const pricing = usePricingTable();
    const wallet = useBillingStore((state) => state.wallet);
    const [quoted, setQuoted] = useState<number | null>(null);

    useEffect(() => {
        if (!visible || !exact || !modelId) return;
        let cancelled = false;
        billingApi.quote(modelId, params, quantity)
            .then((result) => { if (!cancelled) setQuoted(result.credits); })
            .catch(() => { if (!cancelled) setQuoted(null); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, exact, modelId, JSON.stringify(params), quantity]);

    if (!visible || !modelId) return null;

    // `creditsFor` and `creditRange` resolve a picker's legacy flat id to the canonical
    // price-book id themselves, so the raw value is what goes in.
    const unit = creditsFor(pricing, modelId, params);
    // Round once on the total, like the server: a unit that costs a fraction of a credit must
    // not be rounded up before it is multiplied.
    const total = (value: number) => Math.max(1, Math.ceil(value * quantity - 1e-9));
    const credits = quoted ?? (unit === null ? null : total(unit));
    if (credits === null) {
        // No single row matches, which for video means the resolution is not settled yet —
        // it is chosen per shot, after the model. A range is the honest answer there; saying
        // 未定价 implies we cannot price it at all, and picking one row would be a guess.
        // Deliberately not the dearest row either: see the note in modelCost.ts on why the
        // catch-all image row must not be used as a display figure.
        const range = creditRange(pricing, modelId);
        if (range) {
            const [low, high] = [total(range.min), total(range.max)];
            return <span className={styles.cost}>
                <Coins size={12} strokeWidth={2} aria-hidden="true" />
                {low === high ? t("cost", { credits: low }) : t("costRange", { low, high })}
            </span>;
        }
        return <span className={clsx(styles.cost, styles.unpriced)}>{t("unpriced")}</span>;
    }

    // Only warn about the balance when the balance is actually going to be spent. While
    // rates are merely on display there is nothing to be short of, and a red "not enough
    // credits" on a generation that will succeed is worse than saying nothing.
    const insufficient = Boolean(enabled) && wallet?.available !== undefined && wallet.available < credits;
    return (
        <span className={clsx(styles.cost, insufficient && styles.insufficient)}
              title={insufficient ? t("insufficientHint", { available: wallet?.available ?? 0 }) : undefined}>
            <Coins size={12} strokeWidth={2} aria-hidden="true" />
            {t("cost", { credits })}
        </span>
    );
}
