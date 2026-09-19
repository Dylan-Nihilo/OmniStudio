"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { SelectField } from "@omnistudio/ui";

import { api } from "@/lib/api";
import { getTextTiers } from "@/lib/modelCatalog";
import { creditLabel, unitLabels } from "@/lib/modelCost";
import { useBillingStore } from "@/store/billingStore";
import { toast } from "@/store/toastStore";

interface TextTierSelectProps {
    projectId: string | null | undefined;
    /** Told the model that will actually be used, so a caller can price the action. */
    onEffectiveModelChange?: (apiModelId: string | null) => void;
    isDisabled?: boolean;
    className?: string;
}

const INHERIT = "__default__";

/**
 * Which script model this project writes with, where the writing happens.
 *
 * The tier was only reachable through the "Prompt 配置" dialog, so the step that spends the
 * credits gave no sign of which tier it was spending them at. The value is the same
 * `polish_model` that dialog writes — one field, two places to set it, no new state.
 *
 * The stored value is the provider's own model name, because that is the string billing
 * charges against; an empty value means "inherit", which is resolved server-side down the
 * project → series → default chain.
 */
export default function TextTierSelect({ projectId, onEffectiveModelChange, isDisabled, className }: TextTierSelectProps) {
    const t = useTranslations("scriptPage");
    const tBilling = useTranslations("billing");
    const pricing = useBillingStore((state) => state.pricing);
    const [model, setModel] = useState<string>("");
    const [saving, setSaving] = useState(false);

    const tiers = getTextTiers();
    // An inherited tier still costs something, so the caller is told what will really run.
    const effective = model || tiers.find((tier) => tier.recommended)?.id || tiers[0]?.id || null;

    useEffect(() => {
        if (!projectId) return;
        let cancelled = false;
        void api.getPromptConfig(projectId)
            .then((config) => { if (!cancelled) setModel(config?.polish_model ?? ""); })
            .catch(() => { /* leave it on inherit; the dialog reports config failures */ });
        return () => { cancelled = true; };
    }, [projectId]);

    useEffect(() => { onEffectiveModelChange?.(effective); }, [effective, onEffectiveModelChange]);

    const handleChange = useCallback((value: string) => {
        if (!projectId) return;
        const next = value === INHERIT ? "" : value;
        const previous = model;
        setModel(next);
        setSaving(true);
        void api.updatePromptConfig(projectId, { polish_model: next })
            .catch((error) => {
                // Put it back rather than leaving a choice on screen that was never stored.
                setModel(previous);
                toast.error(t("tierSaveFailed"), {
                    body: error instanceof Error ? error.message : undefined,
                });
            })
            .finally(() => setSaving(false));
    }, [projectId, model, t]);

    const options = [
        { id: INHERIT, label: t("tierInherit") },
        ...tiers.map((tier) => ({
            id: tier.id,
            label: tier.name,
            description: creditLabel(pricing, `text/${tier.id}`, unitLabels(tBilling)) ?? undefined,
        })),
    ];
    // A tier that has since been retired still has to show as the current value rather than
    // silently reading as "inherit".
    if (model && !tiers.some((tier) => tier.id === model)) {
        options.push({ id: model, label: model, description: undefined });
    }

    return <SelectField label={t("tierLabel")} className={className} value={model || INHERIT}
                        isDisabled={isDisabled || saving || !projectId}
                        onChange={(key) => handleChange(String(key))} options={options} />;
}
