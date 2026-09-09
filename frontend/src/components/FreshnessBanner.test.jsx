import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FreshnessBanner } from './FreshnessBanner.jsx';
import { api } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ api: { freshness: vi.fn() } }));

const freshness = (overall, snapshotAgeDays, action) => ({
  overall,
  snapshot: { generatedAt: '2026-06-20T00:00:00.000Z', ageDays: snapshotAgeDays, status: overall },
  data: { latestAsOfDate: '2026-08-31', ageDays: 8, status: 'fresh' },
  action,
});

describe('FreshnessBanner', () => {
  test('says nothing while the snapshot is current', async () => {
    // The failure this guards against is the quiet one, so the banner has to
    // stay quiet too until there is something to say. A permanent notice
    // becomes wallpaper.
    api.freshness.mockResolvedValue(freshness('fresh', 0, null));
    const { container } = render(<FreshnessBanner />);
    await waitFor(() => expect(api.freshness).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  test('warns while ageing, without calling the data wrong', async () => {
    api.freshness.mockResolvedValue(freshness('ageing', 40, 'Rebuild the snapshot with: npm run build:data'));
    render(<FreshnessBanner />);
    await waitFor(() => expect(screen.getByText(/ageing/i)).toBeInTheDocument());
    expect(screen.getByText(/40 days ago/)).toBeInTheDocument();
    expect(screen.getByText(/npm run build:data/)).toBeInTheDocument();
  });

  test('escalates the wording once stale', async () => {
    api.freshness.mockResolvedValue(freshness('stale', 80, 'Rebuild the snapshot with: npm run build:data'));
    render(<FreshnessBanner />);
    await waitFor(() => expect(screen.getByText(/out of date/i)).toBeInTheDocument());
    expect(screen.getByText(/31 Aug 2026/)).toBeInTheDocument();
  });

  test('is announced to assistive technology', async () => {
    api.freshness.mockResolvedValue(freshness('stale', 80, 'do the thing'));
    render(<FreshnessBanner />);
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });

  test('stays out of the way if the freshness check itself fails', async () => {
    // A broken check must not blank the page or claim the data is stale.
    api.freshness.mockRejectedValue(new Error('offline'));
    const { container } = render(<FreshnessBanner />);
    await waitFor(() => expect(api.freshness).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
