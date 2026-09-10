"use client";

import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { useTranslations } from "next-intl";
import clsx from "clsx";

import { billingApi } from "@/lib/billing";
import { creditsFor, useBillingStore } from "@/store/billingStore";
import styles from "./CreditCost.module.css";

interface CreditCostProps {
    modelId: string | null | undefined;
    /** Spec the price item matches on: resolution / mode / audio / size_tier / quality. */
    params?: Record<string, unknown>;
    /** Seconds for video, images for image models. */
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
    const pricing = useBillingStore((state) => state.pricing);
    const loadPricing = useBillingStore((state) => state.loadPricing);
    const wallet = useBillingStore((state) => state.wallet);
    const [quoted, setQuoted] = useState<number | null>(null);

    useEffect(() => {
        if (enabled && !pricing) void loadPricing();
    }, [enabled, pricing, loadPricing]);

    useEffect(() => {
        if (!enabled || !exact || !modelId) return;
        let cancelled = false;
        billingApi.quote(modelId, params, quantity)
            .then((result) => { if (!cancelled) setQuoted(result.credits); })
            .catch(() => { if (!cancelled) setQuoted(null); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, exact, modelId, JSON.stringify(params), quantity]);

    if (!enabled || !modelId) return null;

    const unit = creditsFor(pricing, modelId, params);
    const credits = quoted ?? (unit === null ? null : Math.ceil(unit * quantity));
    if (credits === null) {
        return <span className={clsx(styles.cost, styles.unpriced)}>{t("unpriced")}</span>;
    }

    const insufficient = wallet !== null && wallet.available < credits;
    return (
        <span className={clsx(styles.cost, insufficient && styles.insufficient)}
              title={insufficient ? t("insufficientHint", { available: wallet?.available ?? 0 }) : undefined}>
            <Coins size={12} strokeWidth={2} aria-hidden="true" />
            {t("cost", { credits })}
        </span>
    );
}
