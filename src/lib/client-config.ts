// The client every dashboard screen currently acts on.
//
// The app is still single-tenant in the UI: there is no client switcher yet,
// so the dashboard hardcodes the test client rather than reading it from a
// session. When auth lands, replace TEST_CLIENT_ID with the session's client
// and every caller below picks the change up for free.
export const TEST_CLIENT_ID = 'c9c5d722-8b90-4d41-9dc9-b10152ea4dbd'
