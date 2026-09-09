import { Router } from 'express';
import { getSpotPrice, getPriceHistory, SUPPORTED_RANGES } from '../services/price.js';
import { listProviders } from '../services/priceProviders/index.js';
import { stringParam } from '../lib/http.js';

export const priceRouter = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

priceRouter.get('/providers', (_req, res) => {
  res.json({ providers: listProviders(), supportedRanges: SUPPORTED_RANGES });
});

priceRouter.get('/current', async (_req, res, next) => {
  try {
    const price = await getSpotPrice();
    // `raw` is the untouched provider payload, useful when verifying an adapter
    // but not something to leak to the browser.
    const { raw, ...safe } = price;
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

priceRouter.get('/history', async (req, res, next) => {
  try {
    const from = stringParam(req.query, 'from');
    const to = stringParam(req.query, 'to');
    const range = stringParam(req.query, 'range');

    for (const [name, value] of [
      ['from', from],
      ['to', to],
    ]) {
      // Shape first, then reality: 9999-99-99 matches the pattern but is not a
      // date, and silently returning an empty series for it hides the mistake.
      if (value === undefined) continue;
      if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
        return res.status(400).json({ error: `"${name}" must be a real ISO date (YYYY-MM-DD)` });
      }
    }
    if (range !== undefined && !SUPPORTED_RANGES.includes(range)) {
      return res
        .status(400)
        .json({ error: `"range" must be one of: ${SUPPORTED_RANGES.join(', ')}` });
    }
    res.json(await getPriceHistory({ from, to, range }));
  } catch (err) {
    next(err);
  }
});
