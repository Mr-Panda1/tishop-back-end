const express = require('express');
const router = express.Router();
const authenticateUser = require('../../../middlewares/authMiddleware');
const { supabase } = require('../../../db/supabase');
const { sellerStoreLimiter } = require('../../../middlewares/limit');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const sumAmount = (rows, key) => (rows || []).reduce((total, row) => {
	const value = Number(row?.[key] ?? 0);
	return total + (Number.isFinite(value) ? value : 0);
}, 0);

const fetchSeller = async (userId) => {
	const { data: seller, error } = await supabase
		.from('sellers')
		.select('id')
		.eq('user_id', userId)
		.maybeSingle();

	if (error) {
		throw new Error('Error verifying seller');
	}

	return seller;
};

const fetchLatestKyc = async (sellerId) => {
	const { data: kyc, error } = await supabase
		.from('kyc_documents')
		.select('status, payout_method, payout_account_number, payout_account_name')
		.eq('seller_id', sellerId)
		.order('submitted_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (error) {
		throw new Error('Error fetching KYC status');
	}

	return kyc;
};

const fetchBalances = async (sellerId) => {
	const releaseThreshold = new Date(Date.now() - ONE_DAY_MS).toISOString();

	const [
		pendingOrders,
		recentDelivered,
		releasedDelivered,
		deliveredUnknown,
		payouts
	] = await Promise.all([
		supabase
			.from('seller_orders')
			.select('total_amount')
			.eq('seller_id', sellerId)
			.in('status', ['pending', 'confirmed', 'shipped']),
		supabase
			.from('seller_orders')
			.select('total_amount')
			.eq('seller_id', sellerId)
			.eq('status', 'delivered')
			.gt('delivered_at', releaseThreshold),
		supabase
			.from('seller_orders')
			.select('total_amount')
			.eq('seller_id', sellerId)
			.eq('status', 'delivered')
			.lte('delivered_at', releaseThreshold),
		supabase
			.from('seller_orders')
			.select('total_amount')
			.eq('seller_id', sellerId)
			.eq('status', 'delivered')
			.is('delivered_at', null),
		supabase
			.from('payouts')
			.select('id, amount, method, status, requested_at, processed_at, transaction_id')
			.eq('seller_id', sellerId)
			.order('requested_at', { ascending: false })
	]);

	const errors = [
		pendingOrders.error,
		recentDelivered.error,
		releasedDelivered.error,
		deliveredUnknown.error,
		payouts.error
	].filter(Boolean);

	if (errors.length > 0) {
		throw new Error('Error fetching payout balances');
	}

	const pendingOrdersTotal = sumAmount(pendingOrders.data, 'total_amount');
	const recentDeliveredTotal = sumAmount(recentDelivered.data, 'total_amount');
	const releasedDeliveredTotal = sumAmount(releasedDelivered.data, 'total_amount');
	const deliveredUnknownTotal = sumAmount(deliveredUnknown.data, 'total_amount');

	const pendingBalance = pendingOrdersTotal + recentDeliveredTotal + deliveredUnknownTotal;
	const totalEarned = releasedDeliveredTotal + recentDeliveredTotal + deliveredUnknownTotal;

	const reservedPayoutTotal = (payouts.data || []).reduce((total, payout) => {
		if (['pending', 'processing', 'completed'].includes(payout.status)) {
			const value = Number(payout.amount ?? 0);
			return total + (Number.isFinite(value) ? value : 0);
		}
		return total;
	}, 0);

	const availableBalance = Math.max(0, releasedDeliveredTotal - reservedPayoutTotal);

	return {
		balances: {
			available_balance: Number(availableBalance.toFixed(2)),
			pending_balance: Number(pendingBalance.toFixed(2)),
			total_earned: Number(totalEarned.toFixed(2))
		},
		payouts: payouts.data || []
	};
};

// GET /seller/payouts - Get payout history for the authenticated seller
router.get('/payouts', authenticateUser, sellerStoreLimiter, async (req, res) => {
	try {
		const user = req.user;
		const seller = await fetchSeller(user.id);

		if (!seller) {
			return res.status(404).json({ message: 'Seller not found' });
		}

		const [kyc, payoutData] = await Promise.all([
			fetchLatestKyc(seller.id),
			fetchBalances(seller.id)
		]);

		const kycStatus = kyc?.status ?? 'not_submitted';
		const canWithdraw = kycStatus === 'approved';

		return res.status(200).json({
			message: 'Seller payouts retrieved',
			balances: payoutData.balances,
			payouts: payoutData.payouts,
			kyc: {
				status: kycStatus,
				payout_method: kyc?.payout_method || null,
				payout_account_number: kyc?.payout_account_number || null,
				payout_account_name: kyc?.payout_account_name || null
			},
			can_withdraw: canWithdraw
		});
	} catch (error) {
		console.error('Get seller payouts error:', error);
		return res.status(500).json({ message: 'Internal server error' });
	}
});

// POST /seller/payouts/withdraw - Create a new payout request for the authenticated seller
router.post('/payouts/withdraw', authenticateUser, sellerStoreLimiter, async (req, res) => {
	try {
		const user = req.user;
		const amount = Number(req.body?.amount ?? 0);

		if (!Number.isFinite(amount) || amount <= 0) {
			return res.status(400).json({ message: 'Invalid payout amount' });
		}

		const seller = await fetchSeller(user.id);
		if (!seller) {
			return res.status(404).json({ message: 'Seller not found' });
		}

		const kyc = await fetchLatestKyc(seller.id);
		if (!kyc || kyc.status !== 'approved') {
			return res.status(403).json({ message: 'Vérification KYC requise avant les retraits' });
		}

		if (!kyc.payout_method || !kyc.payout_account_number) {
			return res.status(400).json({ message: 'Missing payout account details' });
		}

		const payoutData = await fetchBalances(seller.id);
		const availableBalance = payoutData.balances.available_balance;

		if (amount > availableBalance) {
			return res.status(400).json({
				message: 'Insufficient available balance',
				available_balance: availableBalance
			});
		}

		const nowIso = new Date().toISOString();

		const { data: payout, error: payoutError } = await supabase
			.from('payouts')
			.insert({
				seller_id: seller.id,
				amount,
				method: kyc.payout_method,
				account_number: kyc.payout_account_number,
				status: 'pending',
				requested_at: nowIso
			})
			.select('id, amount, method, status, requested_at')
			.single();

		if (payoutError) {
			console.error('Error creating payout:', payoutError);
			return res.status(500).json({ message: 'Error creating payout request' });
		}

		const { error: txError } = await supabase
			.from('balance_transactions')
			.insert({
				seller_id: seller.id,
				type: 'payout_request',
				amount,
				reference_id: payout.id,
				created_at: nowIso
			});

		if (txError) {
			console.error('Error logging payout transaction:', txError);
		}

		const refreshed = await fetchBalances(seller.id);

		return res.status(201).json({
			message: 'Payout request created',
			payout,
			balances: refreshed.balances
		});
	} catch (error) {
		console.error('Create payout request error:', error);
		return res.status(500).json({ message: 'Internal server error' });
	}
});

module.exports = router;