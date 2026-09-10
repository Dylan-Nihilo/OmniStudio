"use client";

import { useEffect } from "react";
import { Coins } from "lucide-react";
import { useTranslations } from "next-intl";
import clsx from "clsx";

import { useBillingStore } from "@/store/billingStore";
import styles from "./CreditBalance.module.css";

/**
 * Sidebar credit badge. Renders nothing until `/billing/wallet` confirms the deployment
 * bills at all, so desktop and self-hosted installs are unaffected.
 */
export default function CreditBalance({ onOpenLedger }: { onOpenLedger?: () => void }) {
    const t = useTranslations("billing");
    const enabled = useBillingStore((state) => state.enabled);
    const wallet = useBillingStore((state) => state.wallet);
    const refresh = useBillingStore((state) => state.refresh);
    const isLow = useBillingStore((state) => state.isLow);

    useEffect(() => {
        void refresh();
        const timer = setInterval(() => void refresh(), 60_000);
        return () => clearInterval(timer);
    }, [refresh]);

    if (!enabled || wallet?.available === undefined) return null;

    const low = isLow();
    return (
        <button
            type="button"
            onClick={onOpenLedger}
            className={clsx(styles.badge, low && styles.low)}
            title={t("frozenHint", { frozen: wallet.frozen ?? 0 })}
            aria-label={t("balanceAria", { available: wallet.available })}
        >
            <Coins size={16} strokeWidth={1.8} aria-hidden="true" />
            <span className={styles.amount}>{wallet.available.toLocaleString()}</span>
            {(wallet.frozen ?? 0) > 0 && <span className={styles.frozen}>+{wallet.frozen!.toLocaleString()}</span>}
        </button>
    );
}
