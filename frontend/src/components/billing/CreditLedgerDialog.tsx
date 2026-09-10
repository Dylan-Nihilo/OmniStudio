"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Dialog } from "@omnistudio/ui";

import { billingApi, type LedgerEntry } from "@/lib/billing";
import { useBillingStore } from "@/store/billingStore";
import styles from "./CreditLedgerDialog.module.css";

const SIGNED_TYPES = new Set(["purchase", "grant", "transfer_in", "release"]);

export default function CreditLedgerDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
    const t = useTranslations("billing");
    const wallet = useBillingStore((state) => state.wallet);
    const refresh = useBillingStore((state) => state.refresh);
    const [entries, setEntries] = useState<LedgerEntry[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setLoading(true);
        void refresh();
        billingApi.ledger(100)
            .then((page) => setEntries(page.entries))
            .catch(() => setEntries([]))
            .finally(() => setLoading(false));
    }, [isOpen, refresh]);

    return (
        <Dialog
            isOpen={isOpen}
            onOpenChange={(open) => { if (!open) onClose(); }}
            title={t("ledgerTitle")}
            closeLabel={t("close")}
            className={styles.dialog}
            footer={<Button variant="quiet" onPress={onClose}>{t("close")}</Button>}
        >
            <div className={styles.summary}>
                <span><strong>{wallet?.available.toLocaleString() ?? "-"}</strong>{t("available")}</span>
                <span><strong>{wallet?.frozen.toLocaleString() ?? "-"}</strong>{t("frozen")}</span>
            </div>
            {loading && <p className={styles.hint}>{t("loading")}</p>}
            {!loading && entries.length === 0 && <p className={styles.hint}>{t("ledgerEmpty")}</p>}
            {entries.length > 0 && (
                <table className={styles.table}>
                    <thead>
                        <tr><th>{t("time")}</th><th>{t("type")}</th><th>{t("amount")}</th><th>{t("detail")}</th></tr>
                    </thead>
                    <tbody>
                        {entries.map((entry) => (
                            <tr key={entry.id}>
                                <td>{new Date(entry.created_at * 1000).toLocaleString()}</td>
                                <td>{t(`ledgerType.${entry.type}`)}</td>
                                <td className={SIGNED_TYPES.has(entry.type) ? styles.plus : styles.minus}>
                                    {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                                </td>
                                <td className={styles.detail}>
                                    {entry.item_id ?? entry.reason ?? ""}
                                    {entry.quantity !== null && entry.unit_credits !== null
                                        ? ` · ${entry.unit_credits} × ${entry.quantity}`
                                        : ""}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </Dialog>
    );
}
