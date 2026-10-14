const { OAuth2Client } = require('google-auth-library');

let client = null;
function getClient() {
    if (!client) client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    return client;
}

function tokenError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

/**
 * Проверяет ID token от Google Identity Services и возвращает нормализованный профиль.
 * Бросает ошибку с code: 'INVALID_TOKEN' | 'EMAIL_NOT_VERIFIED'.
 */
async function verifyGoogleIdToken(credential) {
    if (!process.env.GOOGLE_CLIENT_ID) {
        throw new Error('GOOGLE_CLIENT_ID is not configured');
    }
    if (!credential || typeof credential !== 'string') {
        throw tokenError('INVALID_TOKEN', 'Missing credential');
    }

    let payload;
    try {
        const ticket = await getClient().verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        payload = ticket.getPayload();
    } catch {
        throw tokenError('INVALID_TOKEN', 'Invalid Google credential');
    }

    if (!payload || !payload.sub || !payload.email) {
        throw tokenError('INVALID_TOKEN', 'Invalid token payload');
    }
    if (!payload.email_verified) {
        throw tokenError('EMAIL_NOT_VERIFIED', 'Google email is not verified');
    }

    return {
        googleId: payload.sub,
        email: String(payload.email).toLowerCase(),
        emailVerified: true,
        name: payload.name || '',
        picture: payload.picture || '',
        issuedAt: payload.iat ? payload.iat * 1000 : 0,
        nonce: payload.nonce || ''
    };
}

// Максимальный возраст токена для повторной авторизации (защита от replay).
const REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Проверяет «свежий» Google-токен для чувствительных действий (удаление аккаунта,
 * установка пароля). Требует совпадения sub, свежести iat и одноразового nonce.
 * Бросает ошибку с code: 'REAUTH_MISMATCH' | 'REAUTH_STALE' | 'REAUTH_NONCE' | ...
 */
async function verifyFreshGoogleReauth(credential, expectedGoogleId, { nonce, maxAgeMs = REAUTH_MAX_AGE_MS } = {}) {
    const profile = await verifyGoogleIdToken(credential);
    if (!expectedGoogleId || profile.googleId !== expectedGoogleId) {
        throw tokenError('REAUTH_MISMATCH', 'Google account does not match');
    }
    const age = Date.now() - (profile.issuedAt || 0);
    if (!profile.issuedAt || age > maxAgeMs || age < 0) {
        throw tokenError('REAUTH_STALE', 'Google credential is too old');
    }
    if (!nonce || !profile.nonce || profile.nonce !== nonce) {
        throw tokenError('REAUTH_NONCE', 'Invalid reauthentication nonce');
    }
    return profile;
}

module.exports = { verifyGoogleIdToken, verifyFreshGoogleReauth };
