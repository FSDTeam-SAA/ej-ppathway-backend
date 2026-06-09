import { Router } from 'express';
import { getContractDetails, signContract } from '../controllers/contract.controller.js';

// Public, token-verified endpoints used by the advisor contract signing page.
// The token (a `contract-sign` JWT) is verified inside the controller, so no
// auth middleware is mounted here.
const router = Router();

router.get('/details', getContractDetails);
router.post('/sign', signContract);

export default router;
