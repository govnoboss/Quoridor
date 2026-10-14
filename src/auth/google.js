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
    } catch (err) {
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
        picture: payload.picture || ''
    };
}

module.exports = { verifyGoogleIdToken };
