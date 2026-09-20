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
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CreditCost from '@/components/billing/CreditCost';
import { useBillingStore } from '@/store/billingStore';
import type { PricingTable } from '@/lib/billing';

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string, values?: Record<string, unknown>) =>
        key === 'cost' ? `消耗 ${values?.credits} 积分` : key,
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
