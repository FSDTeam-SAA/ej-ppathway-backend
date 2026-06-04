import { Router } from 'express';
import {
  listCountries,
  listStates,
  listCities
} from '../controllers/location.controller.js';

const router = Router();

// Public geo catalog for country / state / city dropdowns.
router.get('/countries', listCountries);
router.get('/countries/:code/states', listStates);
router.get('/countries/:code/cities', listCities);

export default router;
