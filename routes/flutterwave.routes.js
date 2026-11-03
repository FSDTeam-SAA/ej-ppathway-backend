import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import { flutterwaveCancel, flutterwaveCatalog, flutterwaveCheckout, flutterwavePending, flutterwaveReturn, flutterwaveStatus } from '../controllers/flutterwave.controller.js';
import { tipCatalog, tipCheckout, tipPending, tipStatus, tipCancel } from '../controllers/flutterwaveTip.controller.js';

const router = Router();
router.get('/return', flutterwaveReturn);
router.use(auth('user'));
router.get('/tips/catalog', tipCatalog);
router.get('/tips/pending', tipPending);
router.post('/tips/checkout', tipCheckout);
router.get('/tips/status', tipStatus);
router.post('/tips/cancel', tipCancel);
router.get('/catalog', flutterwaveCatalog);
router.get('/pending', flutterwavePending);
router.post('/checkout', flutterwaveCheckout);
router.post('/cancel', flutterwaveCancel);
router.get('/status', flutterwaveStatus);
export default router;
