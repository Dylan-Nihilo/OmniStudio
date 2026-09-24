/** @vitest-environment happy-dom */

/**
 * Costs are shown as soon as rates are published, which is a separate switch from whether
 * we charge. The gap between the two is deliberate: the operator checks every price where
 * it will actually be read, and users get a stretch where an action's cost is visible
 * before it starts being taken.
 *
 * The half that is easy to get wrong is the balance warning — while nothing is charged
 * there is nothing to be short of, and a red "not enough credits" on a generation that will
 * succeed is worse than saying nothing at all.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CreditCost from '@/components/billing/CreditCost';
import { useBillingStore } from '@/store/billingStore';
import type { PricingTable } from '@/lib/billing';

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string, values?: Record<string, unknown>) =>
        key === 'cost' ? `消耗 ${values?.credits} 积分`
        : key === 'costRange' ? `约消耗 ${values?.low}–${values?.high} 积分` : key,
}));
vi.mock('@/components/billing/CreditCost.module.css', () => ({
    default: { cost: 'cost', unpriced: 'unpriced', insufficient: 'insufficient' },
}));

const PRICING: PricingTable = {
    version: 1,
    credit_face_value_cny: 0.1,
    items: [
        { item_id: 'v', model_id: 'seedance/seedance-2.0-mini#i2v', stage: 'video', unit: 'second',
          match: { resolution: '480p' }, credits: 19, credits_raw: 19, display_name: '标准' },
        ...[['480p', 32], ['720p', 68], ['1080p', 153]].map(([resolution, credits]) => ({
            item_id: `r2v-${resolution}`, model_id: 'seedance/seedance-2.5-video#r2v', stage: 'video' as const,
            unit: 'second' as const, match: { resolution: String(resolution) }, credits: credits as number,
            credits_raw: credits as number, display_name: 'Seedance 2.5',
        })),
    ],
};

const IMAGE_PRICING: PricingTable = {
    version: 1,
    credit_face_value_cny: 0.1,
    items: [
        { item_id: 'image-1k', model_id: 'gpt-image/gpt-image-2#image', stage: 'image', unit: 'image',
          match: { size_tier: '1K' }, credits: 12, credits_raw: 11.2, display_name: '高级' },
        { item_id: 'image-2k', model_id: 'gpt-image/gpt-image-2#image', stage: 'image', unit: 'image',
          match: { size_tier: '2K' }, credits: 20, credits_raw: 19.4, display_name: '高级' },
    ],
};

function setBilling(state: { enabled: boolean; ratesPublished: boolean; available?: number }) {
    useBillingStore.setState({
        enabled: state.enabled,
        ratesPublished: state.ratesPublished,
        pricing: PRICING,
        wallet: state.available === undefined ? null
            : { enabled: state.enabled, role: null, available: state.available },
    });
}

const shot = { modelId: 'seedance/seedance-2.0-mini#i2v', params: { resolution: '480p' }, quantity: 5 };

beforeEach(() => {
    useBillingStore.setState({ enabled: null, ratesPublished: false, pricing: null, wallet: null });
});

describe('when a cost is shown', () => {
    it('shows the cost once rates are published, before charging is switched on', () => {
        setBilling({ enabled: false, ratesPublished: true });
        render(<CreditCost {...shot} />);
        // 19 credits a second for 5 seconds.
        expect(screen.getByText('消耗 95 积分')).toBeInTheDocument();
    });

    it('prices a legacy image model after resolving its canonical id', () => {
        setBilling({ enabled: false, ratesPublished: true });
        useBillingStore.setState({ pricing: IMAGE_PRICING });
        render(<CreditCost modelId="gpt-image-2" params={{ size_tier: '2K' }} quantity={2} />);
        expect(screen.getByText('消耗 40 积分')).toBeInTheDocument();
    });

    it('shows nothing at all on a deployment that neither charges nor publishes rates', () => {
        setBilling({ enabled: false, ratesPublished: false });
        const { container } = render(<CreditCost {...shot} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('still shows the cost once charging is on', () => {
        setBilling({ enabled: true, ratesPublished: true, available: 10_000 });
        render(<CreditCost {...shot} />);
        expect(screen.getByText('消耗 95 积分')).toBeInTheDocument();
    });
});

describe('the balance warning', () => {
    it('stays quiet while rates are only on display', () => {
        // 95 credits needed against 10 available — but nothing is being spent yet.
        setBilling({ enabled: false, ratesPublished: true, available: 10 });
        render(<CreditCost {...shot} />);
        expect(screen.getByText('消耗 95 积分').closest('span'))
            .not.toHaveClass('insufficient');
    });

    it('fires once the credits are actually going to be taken', () => {
        setBilling({ enabled: true, ratesPublished: true, available: 10 });
        render(<CreditCost {...shot} />);
        expect(screen.getByText('消耗 95 积分').closest('span')).toHaveClass('insufficient');
    });
});

describe('a model with no price', () => {
    it('says so rather than showing a free-looking zero', () => {
        setBilling({ enabled: false, ratesPublished: true });
        render(<CreditCost modelId="something/unpriced#i2v" quantity={5} />);
        expect(screen.getByText('unpriced')).toBeInTheDocument();
    });
});

describe('loading the rate table', () => {
    it('fetches it for a picker with no cost badge on screen', async () => {
        // The regression this pins: the fetch lived inside CreditCost, so every picker that
        // labels its options with a rate read a table nothing had loaded. On the script step
        // — a dropdown and an estimate, no badge — that meant no credits at all.
        const pricingTable = vi.fn().mockResolvedValue(PRICING);
        vi.doMock('@/lib/billing', () => ({ billingApi: { pricingTable, quote: vi.fn() } }));
        vi.resetModules();

        const { usePricingTable, useBillingStore: store } = await import('@/store/billingStore');
        store.setState({ enabled: false, ratesPublished: true, pricing: null });

        const Picker = () => {
            const pricing = usePricingTable();
            return <span>{pricing ? 'rates loaded' : 'no rates'}</span>;
        };
        render(<Picker />);
        await waitFor(() => expect(pricingTable).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByText('rates loaded')).toBeInTheDocument());
        vi.doUnmock('@/lib/billing');
    });

    it('answers many pickers with one request', async () => {
        // A storyboard opens with a panel per shot; each one asks for the table.
        const pricingTable = vi.fn().mockResolvedValue(PRICING);
        vi.doMock('@/lib/billing', () => ({ billingApi: { pricingTable, quote: vi.fn() } }));
        vi.resetModules();

        const { usePricingTable, useBillingStore: store } = await import('@/store/billingStore');
        store.setState({ enabled: false, ratesPublished: true, pricing: null });

        const Picker = () => { usePricingTable(); return null; };
        render(<><Picker /><Picker /><Picker /><Picker /></>);
        await waitFor(() => expect(pricingTable).toHaveBeenCalled());
        expect(pricingTable).toHaveBeenCalledTimes(1);
        vi.doUnmock('@/lib/billing');
    });

    it('does not fetch on a deployment with nothing published', async () => {
        const pricingTable = vi.fn().mockResolvedValue(PRICING);
        vi.doMock('@/lib/billing', () => ({ billingApi: { pricingTable, quote: vi.fn() } }));
        vi.resetModules();

        const { usePricingTable, useBillingStore: store } = await import('@/store/billingStore');
        store.setState({ enabled: false, ratesPublished: false, pricing: null });

        const Picker = () => { usePricingTable(); return null; };
        render(<Picker />);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(pricingTable).not.toHaveBeenCalled();
        vi.doUnmock('@/lib/billing');
    });
});

describe('the id a picker actually holds', () => {
    /**
     * Every picker in the app stores the legacy flat id while the price book is keyed by
     * canonical mode id, and this component handed the raw value straight to the lookup. The
     * result was 未定价 on video, images, cast and the production plan — on a model whose rate
     * the server was charging correctly the whole time.
     */
    it('prices a legacy flat model id', () => {
        setBilling({ enabled: false, ratesPublished: true });
        render(<CreditCost modelId="seedance-2.5-r2v" params={{ resolution: '720p' }} quantity={26} />);
        // The rate the server settled that 26-second take at: 68 × 26 = 1768.
        expect(screen.getByText('消耗 1768 积分')).toBeInTheDocument();
    });

    it('gives a range when the resolution is not settled yet instead of claiming no price', () => {
        // The production plan shows a whole-episode cost before any shot has a resolution;
        // resolution is a per-shot choice, so a single figure there would be a guess.
        setBilling({ enabled: false, ratesPublished: true });
        render(<CreditCost modelId="seedance-2.5-r2v" quantity={10} />);
        expect(screen.getByText('约消耗 320–1530 积分')).toBeInTheDocument();
        expect(screen.queryByText('unpriced')).not.toBeInTheDocument();
    });

    it('still says unpriced when the model has no rate at all', () => {
        setBilling({ enabled: false, ratesPublished: true });
        render(<CreditCost modelId="seedance-9.9-r2v" quantity={10} />);
        expect(screen.getByText('unpriced')).toBeInTheDocument();
    });
});
