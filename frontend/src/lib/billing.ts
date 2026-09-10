import { apiClient, API_URL } from "@/lib/apiClient";

export type PlatformRole = "root" | "admin" | "reseller_admin" | null;

export interface WalletSummary {
    /** False on deployments that do not bill; the credit UI stays hidden. */
    enabled: boolean;
    wallet_id?: string;
    workspace_id?: string;
    balance?: number;
    frozen?: number;
    available?: number;
    role: PlatformRole;
}

export interface LedgerEntry {
    id: string;
    type: "purchase" | "grant" | "adjust" | "transfer_in" | "transfer_out" | "hold" | "settle" | "release" | "expire";
    amount: number;
    balance_after: number;
    frozen_after: number;
    job_item_id: string | null;
    item_id: string | null;
    price_book_version: number | null;
    unit_credits: number | null;
    quantity: number | null;
    reason: string;
    created_at: number;
}

export interface QuoteResult {
    item_id: string;
    unit_credits: number;
    quantity: number;
    credits: number;
    price_book_version: number;
}

export interface PricingTableRow {
    item_id: string;
    model_id: string;
    stage: "text" | "image" | "video" | "tts";
    unit: string;
    match: Record<string, unknown>;
    credits: number;
    display_name: string;
}

export interface PricingTable {
    version: number;
    credit_face_value_cny: number;
    items: PricingTableRow[];
}

export interface CreditRule {
    credit_face_value_cny: number;
    l1_discount: number;
    target_markup: number;
    rounding_step: number;
    min_credits: number;
    credits_per_yuan: number;
    l1_price_per_credit: number;
}

export interface PricingItemRow extends PricingTableRow {
    purchase_price_cny: number;
    multiplier: number;
    list_price_cny: number;
    l1_price_cny: number;
    markup_vs_purchase: number;
    meets_target: boolean;
    enabled: boolean;
}

export interface PriceBookVersion {
    version: number;
    note: string;
    published_by_user_id: string | null;
    published_at: number;
    effective_at: number;
    rule: Omit<CreditRule, "credits_per_yuan" | "l1_price_per_credit">;
    item_count: number;
}

export interface PublishResult {
    version: number;
    item_count: number;
    changes: { item_id: string; before: number | null; after: number }[];
}

/** 402 from any generation endpoint means the wallet ran out mid-flight. */
export function isInsufficientCredits(error: unknown): boolean {
    const response = (error as { response?: { status?: number; data?: { error?: { code?: string } } } })?.response;
    return response?.status === 402 || response?.data?.error?.code === "INSUFFICIENT_CREDITS";
}

export const billingApi = {
    wallet: async (): Promise<WalletSummary> => {
        const res = await apiClient.get<WalletSummary>(`${API_URL}/billing/wallet`);
        return res.data;
    },

    ledger: async (limit = 50, before?: number): Promise<{ wallet_id: string; entries: LedgerEntry[] }> => {
        const res = await apiClient.get(`${API_URL}/billing/ledger`, { params: { limit, before } });
        return res.data;
    },

    quote: async (modelId: string, params: Record<string, unknown> = {}, quantity = 1): Promise<QuoteResult> => {
        const res = await apiClient.post<QuoteResult>(`${API_URL}/billing/quote`, {
            model_id: modelId,
            params,
            quantity,
        });
        return res.data;
    },

    pricingTable: async (): Promise<PricingTable> => {
        const res = await apiClient.get<PricingTable>(`${API_URL}/billing/pricing-table`);
        return res.data;
    },
};

export const billingAdminApi = {
    getRule: async (): Promise<CreditRule> => {
        const res = await apiClient.get<CreditRule>(`${API_URL}/admin/pricing/rule`);
        return res.data;
    },

    updateRule: async (changes: Partial<CreditRule>): Promise<CreditRule & { draft_table: PricingItemRow[] }> => {
        const res = await apiClient.put(`${API_URL}/admin/pricing/rule`, changes);
        return res.data;
    },

    preview: async (purchasePriceCny: number, multiplier = 1, creditsOverride?: number) => {
        const res = await apiClient.post(`${API_URL}/admin/pricing/preview`, {
            purchase_price_cny: purchasePriceCny,
            multiplier,
            credits_override: creditsOverride ?? null,
        });
        return res.data as PricingItemRow;
    },

    listItems: async (): Promise<PricingItemRow[]> => {
        const res = await apiClient.get<PricingItemRow[]>(`${API_URL}/admin/pricing/items`);
        return res.data;
    },

    upsertItem: async (item: {
        model_id: string;
        stage: string;
        billing_unit: string;
        match?: Record<string, unknown>;
        purchase_price_cny: number;
        multiplier?: number;
        credits_override?: number | null;
        display_name?: string;
        enabled?: boolean;
    }): Promise<PricingItemRow> => {
        const res = await apiClient.put<PricingItemRow>(`${API_URL}/admin/pricing/items`, item);
        return res.data;
    },

    deleteItem: async (itemId: string): Promise<{ deleted: boolean }> => {
        const res = await apiClient.delete(`${API_URL}/admin/pricing/items/${encodeURIComponent(itemId)}`);
        return res.data;
    },

    publish: async (note = "", effectiveAt?: number): Promise<PublishResult> => {
        const res = await apiClient.post<PublishResult>(`${API_URL}/admin/pricing/publish`, {
            note,
            effective_at: effectiveAt ?? null,
        });
        return res.data;
    },

    versions: async (): Promise<PriceBookVersion[]> => {
        const res = await apiClient.get<PriceBookVersion[]>(`${API_URL}/admin/pricing/versions`);
        return res.data;
    },

    rollback: async (version: number): Promise<PublishResult> => {
        const res = await apiClient.post(`${API_URL}/admin/pricing/versions/${version}/rollback`);
        return res.data;
    },

    roles: async () => {
        const res = await apiClient.get(`${API_URL}/admin/roles`);
        return res.data as { user_id: string; role: string; granted_by_user_id: string | null; granted_at: number }[];
    },

    grantRole: async (userId: string, role: string) => {
        const res = await apiClient.put(`${API_URL}/admin/roles`, { user_id: userId, role });
        return res.data;
    },

    revokeRole: async (userId: string) => {
        const res = await apiClient.delete(`${API_URL}/admin/roles/${encodeURIComponent(userId)}`);
        return res.data;
    },

    workspaceWallet: async (workspaceId: string) => {
        const res = await apiClient.get(`${API_URL}/admin/wallets/workspace/${encodeURIComponent(workspaceId)}`);
        return res.data as WalletSummary & { ledger: LedgerEntry[] };
    },

    grantCredits: async (workspaceId: string, amount: number, reason = "") => {
        const res = await apiClient.post(`${API_URL}/admin/wallets/grant`, {
            workspace_id: workspaceId,
            amount,
            reason,
        });
        return res.data;
    },

    adjustCredits: async (walletId: string, amount: number, reason: string) => {
        const res = await apiClient.post(`${API_URL}/admin/wallets/adjust`, {
            wallet_id: walletId,
            amount,
            reason,
        });
        return res.data;
    },
};
