jest.mock('google-auth-library', () => {
    const verifyIdToken = jest.fn(async ({ idToken }) => {
        if (idToken === 'valid-token') {
            return { getPayload: () => ({
                sub: 'google-sub-123',
                email: 'NewUser@Gmail.com',
                email_verified: true,
                name: 'New User',
                picture: 'https://lh3.googleusercontent.com/a/pic'
            })};
        }
        if (idToken === 'unverified-token') {
            return { getPayload: () => ({
                sub: 'google-sub-456',
                email: 'unverified@gmail.com',
                email_verified: false,
                name: 'Unverified'
            })};
        }
        throw new Error('Invalid token signature');
    });
    return { OAuth2Client: jest.fn(() => ({ verifyIdToken })) };
});

describe('verifyGoogleIdToken', () => {
    const OLD = process.env.GOOGLE_CLIENT_ID;
    beforeAll(() => { process.env.GOOGLE_CLIENT_ID = 'test-client-id'; });
    afterAll(() => { process.env.GOOGLE_CLIENT_ID = OLD; });

    it('returns a normalized profile for a valid token', async () => {
        const { verifyGoogleIdToken } = require('../src/auth/google');
        const profile = await verifyGoogleIdToken('valid-token');
        expect(profile).toEqual({
            googleId: 'google-sub-123',
            email: 'newuser@gmail.com', // lowercased
            emailVerified: true,
            name: 'New User',
            picture: 'https://lh3.googleusercontent.com/a/pic'
        });
    });

    it('rejects an unverified email', async () => {
        const { verifyGoogleIdToken } = require('../src/auth/google');
        await expect(verifyGoogleIdToken('unverified-token')).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    });

    it('rejects a bad token', async () => {
        const { verifyGoogleIdToken } = require('../src/auth/google');
        await expect(verifyGoogleIdToken('garbage')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    });

    it('throws when GOOGLE_CLIENT_ID is missing', async () => {
        const saved = process.env.GOOGLE_CLIENT_ID;
        delete process.env.GOOGLE_CLIENT_ID;
        const { verifyGoogleIdToken } = require('../src/auth/google');
        await expect(verifyGoogleIdToken('valid-token')).rejects.toThrow(/GOOGLE_CLIENT_ID/);
        process.env.GOOGLE_CLIENT_ID = saved;
    });
});
