"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import clsx from "clsx";
import { Button, SelectField, TextField } from "@omnistudio/ui";

import {
    billingAdminApi,
    type CreditRule,
    type PriceBookVersion,
    type PricingItemRow,
} from "@/lib/billing";
import { useBillingStore } from "@/store/billingStore";
import { toast } from "@/store/toastStore";
import styles from "./BillingAdminPanel.module.css";

const STAGES = ["video", "image", "text", "tts"] as const;
const UNITS: Record<string, string> = { video: "second", image: "image", text: "token_1m", tts: "chars_10k" };

type Tab = "rule" | "items" | "versions" | "roles";

/**
 * Root console for the credit ratio and the price book.
 *
 * The whole point of the layout: root types a purchase price, sees the resulting credits and
 * margin immediately, and nothing reaches users until "publish" freezes a new version.
 */
export default function BillingAdminPanel() {
    const t = useTranslations("billing.admin");
    const role = useBillingStore((state) => state.wallet?.role ?? null);
    const [tab, setTab] = useState<Tab>("rule");
    const [rule, setRule] = useState<CreditRule | null>(null);
    const [items, setItems] = useState<PricingItemRow[]>([]);
    const [versions, setVersions] = useState<PriceBookVersion[]>([]);
    const [roles, setRoles] = useState<{ user_id: string; role: string }[]>([]);
    const [busy, setBusy] = useState(false);

    const isRoot = role === "root";

    const reload = useCallback(async () => {
        try {
            const [nextRule, nextItems, nextVersions] = await Promise.all([
                billingAdminApi.getRule(),
                billingAdminApi.listItems(),
                billingAdminApi.versions(),
            ]);
            setRule(nextRule);
            setItems(nextItems);
            setVersions(nextVersions);
            if (isRoot) setRoles(await billingAdminApi.roles());
        } catch {
            toast.warning(t("loadFailed"));
        }
    }, [isRoot, t]);

    useEffect(() => { void reload(); }, [reload]);

    const dirty = useMemo(() => {
        const published = versions[0];
        if (!published || !rule) return items.length > 0;
        return published.item_count !== items.filter((item) => item.enabled).length
            || published.rule.target_markup !== rule.target_markup
            || published.rule.l1_discount !== rule.l1_discount
            || published.rule.credit_face_value_cny !== rule.credit_face_value_cny;
    }, [items, rule, versions]);

    if (role !== "root" && role !== "admin") {
        return <p className={styles.hint}>{t("forbidden")}</p>;
    }

    return (
        <section className={styles.panel}>
            <nav className={styles.tabs} aria-label={t("title")}>
                {(["rule", "items", "versions", "roles"] as Tab[])
                    .filter((id) => id !== "roles" || isRoot)
                    .map((id) => (
                        <button key={id} type="button" onClick={() => setTab(id)}
                                aria-current={tab === id ? "page" : undefined}
                                className={clsx(styles.tab, tab === id && styles.tabActive)}>
                            {t(`tab.${id}`)}
                        </button>
                    ))}
                <span className={styles.spacer} />
                {dirty && <span className={styles.dirty}>{t("unpublished")}</span>}
                {isRoot && (
                    <Button
                        isDisabled={busy}
                        onPress={async () => {
                            setBusy(true);
                            try {
                                const result = await billingAdminApi.publish();
                                toast.success(t("published", { version: result.version, changed: result.changes.length }));
                                await reload();
                            } catch (error) {
                                const message = (error as { response?: { data?: { error?: { message?: string } } } })
                                    ?.response?.data?.error?.message;
                                toast.warning(message || t("publishFailed"));
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        {t("publish")}
                    </Button>
                )}
            </nav>

            {tab === "rule" && rule && <RuleTab rule={rule} isRoot={isRoot} onSaved={reload} />}
            {tab === "items" && <ItemsTab items={items} isRoot={isRoot} onChanged={reload} />}
            {tab === "versions" && <VersionsTab versions={versions} isRoot={isRoot} onChanged={reload} />}
            {tab === "roles" && isRoot && <RolesTab roles={roles} onChanged={reload} />}
        </section>
    );
}

function RuleTab({ rule, isRoot, onSaved }: { rule: CreditRule; isRoot: boolean; onSaved: () => Promise<void> }) {
    const t = useTranslations("billing.admin");
    const [draft, setDraft] = useState(rule);
    const [probe, setProbe] = useState("1.20");
    const [saving, setSaving] = useState(false);

    useEffect(() => setDraft(rule), [rule]);

    const perYuan = (1 + draft.target_markup) / draft.l1_discount / draft.credit_face_value_cny;
    const price = Number(probe) || 0;
    const credits = price > 0 ? Math.ceil(price * perYuan) : 0;

    return (
        <div className={styles.body}>
            <p className={styles.formula}>
                {t("formula", { perYuan: perYuan.toFixed(1) })}
            </p>
            <div className={styles.grid}>
                <TextField label={t("faceValue")} value={String(draft.credit_face_value_cny)} isDisabled={!isRoot}
                           onChange={(value) => setDraft({ ...draft, credit_face_value_cny: Number(value) || draft.credit_face_value_cny })} />
                <TextField label={t("l1Discount")} value={String(draft.l1_discount)} isDisabled={!isRoot}
                           onChange={(value) => setDraft({ ...draft, l1_discount: Number(value) || draft.l1_discount })} />
                <TextField label={t("targetMarkup")} value={String(draft.target_markup)} isDisabled={!isRoot}
                           onChange={(value) => setDraft({ ...draft, target_markup: Number(value) || draft.target_markup })} />
                <TextField label={t("roundingStep")} value={String(draft.rounding_step)} isDisabled={!isRoot}
                           onChange={(value) => setDraft({ ...draft, rounding_step: Number(value) || draft.rounding_step })} />
            </div>

            <div className={styles.probe}>
                <TextField label={t("probePrice")} value={probe} onChange={setProbe} />
                <dl className={styles.derived}>
                    <div><dt>{t("credits")}</dt><dd>{credits.toLocaleString()}</dd></div>
                    <div><dt>{t("listPrice")}</dt><dd>¥{(credits * draft.credit_face_value_cny).toFixed(2)}</dd></div>
                    <div><dt>{t("l1Price")}</dt><dd>¥{(credits * draft.credit_face_value_cny * draft.l1_discount).toFixed(2)}</dd></div>
                    <div><dt>{t("margin")}</dt>
                        <dd>{price > 0 ? `${(((credits * draft.credit_face_value_cny * draft.l1_discount) / price - 1) * 100).toFixed(0)}%` : "-"}</dd></div>
                </dl>
            </div>

            {isRoot && (
                <Button isDisabled={saving} onPress={async () => {
                    setSaving(true);
                    try {
                        await billingAdminApi.updateRule({
                            credit_face_value_cny: draft.credit_face_value_cny,
                            l1_discount: draft.l1_discount,
                            target_markup: draft.target_markup,
                            rounding_step: draft.rounding_step,
                        });
                        toast.success(t("ruleSaved"));
                        await onSaved();
                    } catch {
                        toast.warning(t("ruleSaveFailed"));
                    } finally {
                        setSaving(false);
                    }
                }}>{t("saveRule")}</Button>
            )}
        </div>
    );
}

function ItemsTab({ items, isRoot, onChanged }: { items: PricingItemRow[]; isRoot: boolean; onChanged: () => Promise<void> }) {
    const t = useTranslations("billing.admin");
    const [edits, setEdits] = useState<Record<string, string>>({});
    const [stage, setStage] = useState<string>("video");
    const [draft, setDraft] = useState({ model_id: "", match: "", price: "" });

    const shown = items.filter((item) => item.stage === stage);

    const save = async (item: PricingItemRow, price: number) => {
        try {
            await billingAdminApi.upsertItem({
                model_id: item.model_id, stage: item.stage, billing_unit: item.unit,
                match: item.match as Record<string, unknown>, purchase_price_cny: price,
                multiplier: item.multiplier, display_name: item.display_name, enabled: item.enabled,
            });
            setEdits((prev) => { const next = { ...prev }; delete next[item.item_id]; return next; });
            await onChanged();
        } catch {
            toast.warning(t("itemSaveFailed"));
        }
    };

    return (
        <div className={styles.body}>
            <div className={styles.stageRow}>
                {STAGES.map((id) => (
                    <button key={id} type="button" onClick={() => setStage(id)}
                            className={clsx(styles.chip, stage === id && styles.chipActive)}>
                        {t(`stage.${id}`)}
                    </button>
                ))}
            </div>

            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>{t("model")}</th><th>{t("spec")}</th><th>{t("purchasePrice")}</th>
                        <th>{t("credits")}</th><th>{t("listPrice")}</th><th>{t("l1Price")}</th><th>{t("margin")}</th>
                        {isRoot && <th />}
                    </tr>
                </thead>
                <tbody>
                    {shown.map((item) => {
                        const edited = edits[item.item_id];
                        return (
                            <tr key={item.item_id} className={clsx(!item.meets_target && styles.belowTarget, !item.enabled && styles.disabled)}>
                                <td className={styles.mono}>{item.model_id}</td>
                                <td className={styles.mono}>{Object.entries(item.match).map(([k, v]) => `${k}=${v}`).join(" ") || "-"}</td>
                                <td>
                                    {isRoot
                                        ? <input className={styles.priceInput} value={edited ?? String(item.purchase_price_cny)}
                                                 onChange={(event) => setEdits((prev) => ({ ...prev, [item.item_id]: event.target.value }))} />
                                        : item.purchase_price_cny}
                                </td>
                                <td className={styles.strong}>{item.credits.toLocaleString()}</td>
                                <td>¥{item.list_price_cny.toFixed(2)}</td>
                                <td>¥{item.l1_price_cny.toFixed(2)}</td>
                                <td>{(item.markup_vs_purchase * 100).toFixed(0)}%</td>
                                {isRoot && (
                                    <td>
                                        {edited !== undefined && Number(edited) !== item.purchase_price_cny && (
                                            <Button size="sm" onPress={() => void save(item, Number(edited))}>{t("save")}</Button>
                                        )}
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                    {shown.length === 0 && <tr><td colSpan={8} className={styles.hint}>{t("noItems")}</td></tr>}
                </tbody>
            </table>

            {isRoot && (
                <div className={styles.newItem}>
                    <TextField label={t("model")} value={draft.model_id} onChange={(v) => setDraft({ ...draft, model_id: v })} />
                    <TextField label={t("specHint")} value={draft.match} onChange={(v) => setDraft({ ...draft, match: v })} />
                    <TextField label={t("purchasePrice")} value={draft.price} onChange={(v) => setDraft({ ...draft, price: v })} />
                    <Button isDisabled={!draft.model_id || !draft.price} onPress={async () => {
                        const match: Record<string, unknown> = {};
                        for (const pair of draft.match.split(/[,\s]+/).filter(Boolean)) {
                            const [key, value] = pair.split("=");
                            if (key && value) match[key] = value === "true" ? true : value;
                        }
                        try {
                            await billingAdminApi.upsertItem({
                                model_id: draft.model_id.trim(), stage, billing_unit: UNITS[stage],
                                match, purchase_price_cny: Number(draft.price),
                            });
                            setDraft({ model_id: "", match: "", price: "" });
                            await onChanged();
                        } catch {
                            toast.warning(t("itemSaveFailed"));
                        }
                    }}>{t("addItem")}</Button>
                </div>
            )}
        </div>
    );
}

function VersionsTab({ versions, isRoot, onChanged }: { versions: PriceBookVersion[]; isRoot: boolean; onChanged: () => Promise<void> }) {
    const t = useTranslations("billing.admin");
    return (
        <div className={styles.body}>
            <table className={styles.table}>
                <thead>
                    <tr><th>{t("version")}</th><th>{t("publishedAt")}</th><th>{t("itemCount")}</th><th>{t("ratio")}</th><th>{t("note")}</th>{isRoot && <th />}</tr>
                </thead>
                <tbody>
                    {versions.map((version, index) => (
                        <tr key={version.version}>
                            <td className={styles.strong}>v{version.version}{index === 0 && <span className={styles.live}>{t("live")}</span>}</td>
                            <td>{new Date(version.published_at * 1000).toLocaleString()}</td>
                            <td>{version.item_count}</td>
                            <td>{((1 + version.rule.target_markup) / version.rule.l1_discount / version.rule.credit_face_value_cny).toFixed(1)}</td>
                            <td>{version.note}</td>
                            {isRoot && (
                                <td>{index > 0 && (
                                    <Button size="sm" variant="quiet" onPress={async () => {
                                        await billingAdminApi.rollback(version.version);
                                        toast.success(t("rolledBack", { version: version.version }));
                                        await onChanged();
                                    }}>{t("rollback")}</Button>
                                )}</td>
                            )}
                        </tr>
                    ))}
                    {versions.length === 0 && <tr><td colSpan={6} className={styles.hint}>{t("noVersions")}</td></tr>}
                </tbody>
            </table>
        </div>
    );
}

function RolesTab({ roles, onChanged }: { roles: { user_id: string; role: string }[]; onChanged: () => Promise<void> }) {
    const t = useTranslations("billing.admin");
    const [userId, setUserId] = useState("");
    const [role, setRole] = useState("admin");
    return (
        <div className={styles.body}>
            <table className={styles.table}>
                <thead><tr><th>{t("userId")}</th><th>{t("role")}</th><th /></tr></thead>
                <tbody>
                    {roles.map((entry) => (
                        <tr key={entry.user_id}>
                            <td className={styles.mono}>{entry.user_id}</td>
                            <td>{entry.role}</td>
                            <td><Button size="sm" variant="quiet" onPress={async () => {
                                try {
                                    await billingAdminApi.revokeRole(entry.user_id);
                                    await onChanged();
                                } catch {
                                    toast.warning(t("revokeFailed"));
                                }
                            }}>{t("revoke")}</Button></td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className={styles.newItem}>
                <TextField label={t("userId")} value={userId} onChange={setUserId} />
                <SelectField label={t("role")} selectedKey={role} onSelectionChange={(key) => setRole(String(key))}
                             options={[{ id: "admin", label: "admin" }, { id: "reseller_admin", label: "reseller_admin" }, { id: "root", label: "root" }]} />
                <Button isDisabled={!userId} onPress={async () => {
                    try {
                        await billingAdminApi.grantRole(userId.trim(), role);
                        setUserId("");
                        await onChanged();
                    } catch {
                        toast.warning(t("grantFailed"));
                    }
                }}>{t("grant")}</Button>
            </div>
        </div>
    );
}
