/*
 * Friends of Green Lake Crew — Payment Accounts
 * ------------------------------------------------
 * ACTION NEEDED BEFORE LAUNCH: every value below is a placeholder.
 * Replace each with FOGLC's real, verified account info before this
 * site goes live — sending real donors to a placeholder handle would
 * misdirect their gifts.
 *
 * These accounts are org-wide (PayPal/Venmo/Zelle don't support
 * per-cause sub-accounts). Whichever cause a visitor selects on the
 * Support page, we ask them to add it as a note/memo on the payment
 * so FOGLC's treasurer can route the gift correctly.
 */
window.FOGLC_PAYMENT = {
  paypal: {
    label: "PayPal",
    // Full PayPal.me link or paypal.com/donate link, e.g. "https://paypal.me/FOGLC"
    url: "https://paypal.me/REPLACE_ME",
    display: "paypal.me/REPLACE_ME",
    configured: false
  },
  venmo: {
    label: "Venmo",
    // Venmo handle including the @, e.g. "@FriendsOfGreenLakeCrew"
    handle: "@REPLACE_ME",
    configured: false
  },
  zelle: {
    label: "Zelle",
    // Zelle-registered email or phone number, e.g. "treasurer@greenlakecrew.org"
    handle: "REPLACE_ME@example.org",
    configured: false
  }
};
