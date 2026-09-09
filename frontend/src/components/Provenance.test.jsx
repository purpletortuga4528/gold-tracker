import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provenance } from './Provenance.jsx';

const META = {
  source: 'International Monetary Fund, IRFCL',
  sourceUrl: 'https://data.imf.org/en/datasets/IMF.STA:IRFCL',
  countryCount: 85,
  latestAsOfDate: '2026-08-31',
  generatedAt: '2026-09-08T20:06:59.070Z',
  indicatorNote: 'Gold volume in fine troy ounces, converted to tonnes.',
  valuationNote: 'Tonnes only; dollar figures are tonnes x market price.',
  shareNote: "Gold's share is computed live, not read off the IMF totals.",
  coverageNote: 'Do not read the sum of these rows as a world total.',
  scaleCorrections: [{ countryCode: 'BRA', divisor: 1000, evidence: 'implies $4.04 per ounce' }],
  quarantined: [],
};

describe('provenance', () => {
  test('names the source and links to it', () => {
    render(<Provenance meta={META} />);
    const link = screen.getByRole('link', { name: /International Monetary Fund/ });
    expect(link).toHaveAttribute('href', META.sourceUrl);
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  test('carries the caveats that stop the table being misread', () => {
    render(<Provenance meta={META} />);
    expect(screen.getByText(/world total/)).toBeInTheDocument();
    expect(screen.getByText(/tonnes x market price/)).toBeInTheDocument();
    expect(screen.getByText(/computed live/)).toBeInTheDocument();
  });

  test('shows the arithmetic behind any unit correction', () => {
    render(<Provenance meta={META} />);
    expect(screen.getByText(/BRA/)).toBeInTheDocument();
    expect(screen.getByText(/implies \$4.04 per ounce/)).toBeInTheDocument();
    expect(screen.getByText(/not.*from a hand-written list/i)).toBeInTheDocument();
  });

  test('lists anything excluded as implausible', () => {
    render(
      <Provenance
        meta={{
          ...META,
          quarantined: [{ countryCode: 'XXX', countryName: 'Nowhere', reason: 'implies 90,000 t' }],
        }}
      />,
    );
    expect(screen.getByText(/Excluded as implausible/)).toBeInTheDocument();
    expect(screen.getByText(/implies 90,000 t/)).toBeInTheDocument();
  });

  test('renders nothing rather than crashing when metadata has not arrived', () => {
    const { container } = render(<Provenance meta={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the source URL is data, not a literal', () => {
  // It reaches the href from a generated file, and React does not block a
  // javascript: URL, it only warns in development.
  test.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['/relative'],
    [''],
    [null],
  ])('refuses to make a link out of %s', (hostile) => {
    render(<Provenance meta={{ ...META, sourceUrl: hostile }} />);
    expect(screen.queryByRole('link')).toBeNull();
    // The attribution still shows; only the link is withheld.
    expect(screen.getByText(META.source)).toBeInTheDocument();
  });

  test('still links an ordinary http URL', () => {
    render(<Provenance meta={{ ...META, sourceUrl: 'http://example.org/data' }} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'http://example.org/data');
  });
});
