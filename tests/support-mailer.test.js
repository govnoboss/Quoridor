jest.mock('resend', () => ({ Resend: jest.fn(() => ({ emails: { send: jest.fn(async () => ({ data: { id: 'test-mail' } })) } })) }));
const { Resend } = require('resend');
const { sendSupportReplyEmail } = require('../src/utils/mailer');
const saved = { RESEND_API_KEY: process.env.RESEND_API_KEY, EMAIL_FROM: process.env.EMAIL_FROM, SITE_URL: process.env.SITE_URL };
beforeAll(() => { process.env.RESEND_API_KEY = 'isolated-test'; process.env.EMAIL_FROM = 'Support <support@example.test>'; process.env.SITE_URL = 'https://example.test'; });
afterAll(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
test('support email uses provider idempotency, authenticated deep link and no conversation content', async () => {
    await expect(sendSupportReplyEmail('recipient@example.test', 'report-id', 'notification-id')).resolves.toEqual({ id: 'test-mail' });
    const send = Resend.mock.results[0].value.emails.send;
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'recipient@example.test', text: expect.stringContaining('https://example.test/profile/reports?report=report-id') }), { idempotencyKey: 'support-notification/notification-id' });
});
test('provider rejection throws so a job remains retryable', async () => {
    Resend.mock.results[0].value.emails.send.mockResolvedValueOnce({ error: { message: 'rejected' } });
    await expect(sendSupportReplyEmail('recipient@example.test', 'report', 'notification')).rejects.toThrow('Support email delivery failed');
});
