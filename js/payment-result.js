(() => {
    const title = document.getElementById('payment-title');
    const message = document.getElementById('payment-message');
    const retryButton = document.getElementById('retry-verification');
    const orderLink = document.getElementById('order-link');
    const walletLink = document.getElementById('wallet-link');
    const guestTokenPanel = document.getElementById('guest-token-panel');
    const guestTokenNode = document.getElementById('guest-tracking-token');
    const copyTokenButton = document.getElementById('copy-guest-token');
    const copyTokenStatus = document.getElementById('copy-token-status');
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') || params.get('trxref') || '';
    let context = null;
    try { context = JSON.parse(window.sessionStorage.getItem('xdrive_payment_context') || 'null'); } catch { context = null; }

    // Remove provider query parameters from the visible URL after reading them.
    if (window.history?.replaceState) window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);

    function show(messageText, { heading, retry = false, isError = false } = {}) {
        if (heading) title.textContent = heading;
        message.textContent = messageText;
        message.setAttribute('aria-invalid', String(isError));
        retryButton.hidden = !retry;
    }

    async function verify() {
        if (!reference) {
            show('No Paystack reference was returned. If you completed payment, contact X-Drive support and include the payment receipt reference.', {
                heading: 'Payment reference missing', isError: true
            });
            return;
        }
        retryButton.disabled = true;
        show('X-Drive is checking the transaction directly with Paystack. A redirect alone is not treated as proof of payment.', { heading: 'Verifying payment' });
        try {
            const result = await window.xdriveAPI.verifyPayment(reference, context?.trackingToken || null);
            if (result.status !== 'paid' || result.verified === false) {
                show(`Payment is not confirmed yet (status: ${result.status || 'pending'}). Do not submit another payment. Use “Check again” shortly.`, {
                    heading: 'Payment not confirmed', retry: true
                });
                return;
            }

            if (result.kind === 'wallet_deposit' || context?.kind === 'wallet_deposit') {
                title.textContent = 'Wallet deposit confirmed';
                let balanceLine = '';
                try {
                    const wallet = await window.xdriveAPI.getWallet();
                    const amount = Number(wallet.balanceMinor || 0) / 100;
                    balanceLine = ` Your available wallet balance is ${new Intl.NumberFormat('en-US', { style: 'currency', currency: wallet.currency || result.currency || 'USD' }).format(amount)}.`;
                } catch {
                    balanceLine = ' Your wallet balance will appear after signing in again if needed.';
                }
                message.textContent = `The Paystack transaction was verified and the deposit was recorded.${balanceLine} Real supplier fulfillment remains disabled.`;
                walletLink.hidden = false;
                retryButton.hidden = true;
                return;
            }

            const orderId = result.orderId || context?.orderId;
            if (orderId) {
                title.textContent = 'Payment confirmed';
                message.textContent = `Payment verified by X-Drive. Order ${orderId} is recorded as pending. No order has been sent to the supplier because real fulfillment is disabled in this release.`;
                orderLink.href = `customer-dashboard/orders.html?orderId=${encodeURIComponent(orderId)}`;
                orderLink.hidden = false;
                if (context?.trackingToken) {
                    guestTokenNode.textContent = context.trackingToken;
                    guestTokenPanel.hidden = false;
                }
                retryButton.hidden = true;
                return;
            }
            show('Payment was verified, but the related order could not be located. Contact X-Drive support with your receipt reference.', {
                heading: 'Payment verified; order lookup needed', isError: true
            });
        } catch (error) {
            show(`${error.message} If payment was completed, do not pay again; retry verification or contact X-Drive support.`, {
                heading: 'Unable to verify yet', retry: true, isError: true
            });
        } finally {
            retryButton.disabled = false;
        }
    }

    retryButton.addEventListener('click', verify);
    copyTokenButton.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(guestTokenNode.textContent);
            copyTokenStatus.textContent = 'Tracking token copied.';
        } catch {
            copyTokenStatus.textContent = 'Copy is unavailable. Select the token above and copy it manually.';
        }
    });
    verify();
})();
