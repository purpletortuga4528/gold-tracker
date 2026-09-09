import { Router } from 'express';
import { listReserves, getReserve, getReservesMeta } from '../services/reserves.js';
import { getFreshness } from '../services/freshness.js';
import { stringParam, numberParam } from '../lib/http.js';

export const reservesRouter = Router();

/** Bounded so a caller cannot ask the server to build an enormous array. */
const MAX_LIMIT = 1000;

reservesRouter.get('/meta', async (_req, res, next) => {
  try {
    res.json(await getReservesMeta());
  } catch (err) {
    next(err);
  }
});

reservesRouter.get('/freshness', async (_req, res, next) => {
  try {
    res.json(await getFreshness());
  } catch (err) {
    next(err);
  }
});

reservesRouter.get('/', async (req, res, next) => {
  try {
    // Every parameter goes through a validator that rejects arrays and objects.
    // Reading req.query straight into string methods threw a TypeError on
    // `?kind=a&kind=b`, which any client can send.
    const search = stringParam(req.query, 'search');
    const region = stringParam(req.query, 'region');
    const kind = stringParam(req.query, 'kind');
    const limit = numberParam(req.query, 'limit', { min: 1, max: MAX_LIMIT, integer: true });

    res.json(await listReserves({ search, region, kind, limit }));
  } catch (err) {
    next(err);
  }
});

reservesRouter.get('/:code', async (req, res, next) => {
  try {
    const result = await getReserve(req.params.code);
    if (!result) {
      return res.status(404).json({ error: 'No reserves data for that code' });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});
