const { publicNotification, publicReport } = require('./service');
const rateLimit = require('express-rate-limit');
const validId = id => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
const validKey = key => key === undefined || (typeof key === 'string' && /^[\w-]{1,80}$/.test(key));
const text = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
function registerNotificationRoutes({ app, User, Report, Notification, service, reportLimiter, requireAdmin, getClientIp }) {
    app.use(['/api/notifications', '/api/reports', '/api/my/reports', '/api/admin/reports'], (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    const replyLimiter = rateLimit({ windowMs: 3600000, max: 30, standardHeaders: true, legacyHeaders: false });
    const auth = (req, res, next) => req.session.userId ? next() : res.status(401).json({ error: 'Unauthorized' });
    const safe = fn => async (req, res) => { try { await fn(req, res); } catch (e) { console.error('[NOTIFICATION API]', e.name || 'Error'); res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error. Please retry.' }); } };
    const idCheck = (req, res, next) => validId(req.params.id) ? next() : res.status(400).json({ error: 'Invalid ID' });
    app.post('/api/reports', auth, reportLimiter, safe(async (req, res) => {
        const { subject, description, deviceInfo = {} } = req.body || {};
        if (!text(subject, 3, 200) || !text(description, 10, 5000)) return res.status(400).json({ error: 'Subject: 3–200 characters; description: 10–5000 characters' });
        const info = {}; for (const key of ['userAgent', 'platform', 'screenSize', 'language']) info[key] = typeof deviceInfo?.[key] === 'string' ? deviceInfo[key].slice(0, key === 'userAgent' ? 500 : 100) : '';
        const report = await Report.create({ subject: subject.trim(), description: description.trim(), userId: req.session.userId, ip: getClientIp(req), deviceInfo: info, messages: [{ role: 'user', text: description.trim(), notificationPending: true }] });
        await service.drain().catch(() => console.error('[NOTIFICATION] Delivery queued'));
        res.status(201).json({ message: 'Report submitted', id: report._id });
    }));
    app.get('/api/admin/reports', requireAdmin, safe(async (req, res) => res.json((await Report.find().sort({ createdAt: -1 }).populate('userId', 'username avatarUrl').lean()).map(r => publicReport(r, true)))));
    app.patch('/api/admin/reports/:id', requireAdmin, idCheck, safe(async (req, res) => {
        const { status, reply, clientRequestId } = req.body || {};
        if ((status !== undefined && !['new', 'in_progress', 'closed'].includes(status)) || (reply !== undefined && !text(reply, 1, 5000)) || !validKey(clientRequestId) || (!status && reply === undefined)) return res.status(400).json({ error: 'Invalid status, reply or request key' });
        let report = await Report.findById(req.params.id); if (!report) return res.status(404).json({ error: 'Report not found' });
        if (reply !== undefined) report = await service.reply(req.params.id, 'admin', reply.trim(), clientRequestId);
        if (status) report = await Report.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true, runValidators: true });
        res.json(publicReport(report, true));
    }));
    app.get('/api/my/reports', auth, safe(async (req, res) => res.json((await Report.find({ userId: req.session.userId }).sort({ createdAt: -1 }).lean()).map(r => publicReport(r)))));
    async function owned(req, res) {
        const report = await Report.findById(req.params.id);
        if (!report) { res.status(404).json({ error: 'Report not found' }); return null; }
        if (String(report.userId) !== String(req.session.userId)) { res.status(403).json({ error: 'Forbidden' }); return null; } return report;
    }
    app.get('/api/reports/:id', auth, idCheck, safe(async (req, res) => {
        const readThrough = new Date();
        const report = await Report.findById(req.params.id).populate('userId', 'username avatarUrl');
        if (!report) return res.status(404).json({ error: 'Report not found' });
        const admin = await User.findById(req.session.userId).select('isAdmin');
        if (String(report.userId?._id) !== String(req.session.userId) && !admin?.isAdmin) return res.status(403).json({ error: 'Forbidden' });
        res.set('Cache-Control', 'no-store').json({ ...publicReport(report, Boolean(admin?.isAdmin)), readThrough });
    }));
    app.post('/api/reports/:id/reply', auth, replyLimiter, idCheck, safe(async (req, res) => {
        if (!text(req.body?.text, 1, 5000) || !validKey(req.body?.clientRequestId)) return res.status(400).json({ error: 'Message: 1–5000 characters; invalid request key' });
        if (!await owned(req, res)) return;
        await service.reply(req.params.id, 'user', req.body.text.trim(), req.body.clientRequestId, req.session.userId);
        res.json({ message: 'Reply sent' });
    }));
    app.post('/api/reports/:id/read', auth, idCheck, safe(async (req, res) => {
        const report = await Report.findById(req.params.id); if (!report) return res.sendStatus(404);
        const admin = await User.findById(req.session.userId).select('isAdmin');
        const isOwner = String(report.userId) === String(req.session.userId);
        if (!isOwner && !admin?.isAdmin) return res.sendStatus(403);
        // Only notifications that existed when the conversation was fetched are acknowledged.
        const through = req.body?.through ? new Date(req.body.through) : new Date();
        if (!Number.isFinite(through.getTime())) return res.status(400).json({ error: 'Invalid read cutoff' });
        const modified = await service.markAll(req.session.userId, { 'data.reportId': report._id, createdAt: { $lte: through } });
        res.json({ success: true, modified });
    }));
    app.get('/api/notifications/preferences', auth, safe(async (req, res) => {
        const user = await User.findById(req.session.userId).select('notificationPreferences');
        res.json({ supportEmail: Boolean(user?.notificationPreferences?.supportEmail), emailAvailable: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) });
    }));
    app.patch('/api/notifications/preferences', auth, safe(async (req, res) => {
        if (typeof req.body?.supportEmail !== 'boolean') return res.status(400).json({ error: 'supportEmail must be boolean' });
        if (req.body.supportEmail && !(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) && process.env.NODE_ENV !== 'test') return res.status(503).json({ error: 'Email delivery is unavailable' });
        await User.updateOne({ _id: req.session.userId }, { $set: { 'notificationPreferences.supportEmail': req.body.supportEmail } });
        res.json({ supportEmail: req.body.supportEmail });
    }));
    app.get('/api/notifications', auth, safe(async (req, res) => {
        const page = Math.min(10000, Math.max(1, parseInt(req.query.page) || 1)), limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const filter = { recipient: req.session.userId, ...(req.query.unread === 'true' ? { read: false } : {}) };
        const [rows, total, unreadTotal] = await Promise.all([Notification.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), Notification.countDocuments(filter), Notification.countDocuments({ recipient: req.session.userId, read: false })]);
        res.set('Cache-Control', 'no-store').json({ notifications: rows.map(n => publicNotification(n)), total, unreadTotal, page, limit });
    }));
    app.patch('/api/notifications/read-all', auth, safe(async (req, res) => res.json({ success: true, modified: await service.markAll(req.session.userId) })));
    app.patch('/api/notifications/:id/read', auth, idCheck, safe(async (req, res) => { const n = await service.markRead(req.session.userId, req.params.id); if (!n) return res.sendStatus(404); res.json({ success: true, notification: n }); }));
    app.delete('/api/notifications/:id', auth, idCheck, safe(async (req, res) => {
        await service.serial(req.session.userId, async () => {
            const n = await Notification.findOneAndDelete({ _id: req.params.id, recipient: req.session.userId });
            if (!n) return res.sendStatus(404);
            await User.updateOne({ _id: req.session.userId }, { $set: { unreadNotifications: await Notification.countDocuments({ recipient: req.session.userId, read: false }) } });
            res.json({ success: true });
        });
    }));
}
module.exports = { registerNotificationRoutes };
