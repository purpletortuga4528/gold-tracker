import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PriceHeadline } from './PriceHeadline.jsx';
import { PriceProvider } from '../lib/usePrice.jsx';
import { api } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ api: { currentPrice: vi.fn() } }));

const LBMA = {
  priceUsdPerOunce: 4402.55,
  currency: 'USD',
  asOfDate: '2026-09-07',
  kind: 'benchmark',
  benchmark: 'LBMA Gold Price PM',
  alternates: { GBP: 3252.16, EUR: 3786.19 },
  provider: 'lbma',
  providerLabel: 'LBMA Gold Price',
  note: 'Once-daily auction benchmark (PM fix), not a live spot quote.',
};

const show = () =>
  render(
    <PriceProvider>
      <PriceHeadline />
    </PriceProvider>,
  );

beforeEach(() => {
  api.currentPrice.mockReset();
});

describe('what the headline claims', () => {
  test('states the price with the benchmark and its date', async () => {
    api.currentPrice.mockResolvedValue(LBMA);
    show();
    await waitFor(() => expect(screen.getByText('$4,402.55')).toBeInTheDocument());
    expect(screen.getByText('LBMA Gold Price PM')).toBeInTheDocument();
    expect(screen.getByText(/7 Sept 2026/)).toBeInTheDocument();
    expect(screen.getByText('per troy ounce')).toBeInTheDocument();
  });

  test('says "daily benchmark", not "live", because that is what it is', async () => {
    // The whole point of the labelling. A once-daily auction result presented
    // as a live tick would be the app's most misleading possible claim.
    api.currentPrice.mockResolvedValue(LBMA);
    show();
    await waitFor(() => expect(screen.getByText('Daily benchmark')).toBeInTheDocument());
    expect(screen.getByText(/not a live spot quote/)).toBeInTheDocument();
    expect(screen.queryByText(/^Spot$/)).toBeNull();
  });

  test('labels a provider as spot when it genuinely is', async () => {
    api.currentPrice.mockResolvedValue({ ...LBMA, kind: 'spot', benchmark: undefined, note: undefined });
    show();
    await waitFor(() => expect(screen.getByText('Spot')).toBeInTheDocument());
  });

  test('shows the other currencies the same fix was struck in', async () => {
    api.currentPrice.mockResolvedValue(LBMA);
    show();
    await waitFor(() => expect(screen.getByText(/GBP 3,252.16/)).toBeInTheDocument());
    expect(screen.getByText(/EUR 3,786.19/)).toBeInTheDocument();
  });

  test('flags a stale value rather than passing it off as current', async () => {
    api.currentPrice.mockResolvedValue({ ...LBMA, stale: true, cached: true, cacheAgeSeconds: 900 });
    show();
    await waitFor(() => expect(screen.getByText(/Stale/)).toBeInTheDocument());
  });
});

describe('failure', () => {
  test('explains the likely cause instead of showing a blank space', async () => {
    // An async throw rather than mockRejectedValue: the latter builds the
    // rejected promise before anything has attached a handler, which Vitest
    // reports as an unhandled rejection and fails the test on.
    api.currentPrice.mockImplementation(async () => {
      throw new Error('Could not reach the gold price provider');
    });
    show();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/Could not reach the gold price provider/)).toBeInTheDocument();
    // The hint says what is still true, rather than guessing at a cause. It
    // used to read "is the backend running on port 5174", which is exactly
    // wrong in the case that actually happened: the backend was running and
    // the LBMA feed had gone behind a Cloudflare challenge.
    expect(screen.getByText(/tonnages are still right/i)).toBeInTheDocument();
  });

  test('shows a loading state while the request is in flight', async () => {
    // Resolved at the end rather than left hanging: a promise that never
    // settles outlives the test and stalls the next hook.
    let release;
    api.currentPrice.mockReturnValue(new Promise((resolve) => {
      release = () => resolve(LBMA);
    }));

    show();
    expect(screen.getByRole('status')).toBeInTheDocument();

    release();
    await waitFor(() => expect(screen.getByText('$4,402.55')).toBeInTheDocument());
  });
});

describe('one price for the whole app', () => {
  test('two consumers share a single fetch', async () => {
    // A table and a detail page must not disagree about what gold is worth.
    api.currentPrice.mockResolvedValue(LBMA);
    render(
      <PriceProvider>
        <PriceHeadline />
        <PriceHeadline />
      </PriceProvider>,
    );
    await waitFor(() => expect(screen.getAllByText('$4,402.55')).toHaveLength(2));
    expect(api.currentPrice).toHaveBeenCalledTimes(1);
  });
});

describe('when there is no price at all', () => {
  /** Drives the real provider into its error state, as the tests above do. */
  const fail = async () => {
    api.currentPrice.mockImplementation(async () => {
      throw new Error('Could not reach the gold price provider');
    });
    show();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  };

  test('it works an example through, so the empty columns are not a mystery', async () => {
    /*
     * A reader who arrives with the feed shut has never seen the dollar
     * columns do anything. This shows what they would do, without quoting a
     * real price: the benchmark is licensed, which is why they are empty.
     */
    await fail();

    expect(screen.getByText(/What a price would give you/)).toBeInTheDocument();
    // $128.6M, not $128.60M: formatUsdCompact caps at two fraction digits and
    // so drops the trailing zero. Asserted as the component actually renders
    // it rather than as a hand-computed toFixed(2).
    expect(screen.getByText(/32,150\.7466/)).toBeInTheDocument();
    expect(screen.getByText(/\$128\.6M/)).toBeInTheDocument();
  });

  test('the example is marked hypothetical, twice, and quotes no real benchmark', async () => {
    // The figure must never read as a quote. If it did, this panel would be
    // redistributing the thing the app is careful not to redistribute.
    await fail();

    expect(screen.getByText(/at a hypothetical/)).toBeInTheDocument();
    expect(screen.getByText(/an illustration, not a quote/)).toBeInTheDocument();
    expect(screen.queryByText(/LBMA/)).not.toBeInTheDocument();

    /*
     * The only per-ounce figure on the panel is the round hypothetical one.
     *
     * Asserted by shape rather than by naming the real fix: writing that value
     * here would make this file hold a recorded price, which is the thing
     * NOTICE.md inventories and check:docs counts. It flagged exactly that on
     * the first version of this test.
     */
    const perOunce = [...screen.getByText(/at a hypothetical/).textContent.matchAll(/\$([\d,]+)\.?\d* an ounce/g)];
    expect(perOunce).toHaveLength(1);
    expect(perOunce[0][1]).toBe('4,000');
  });
});
