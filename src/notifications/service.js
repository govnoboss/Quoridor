const { randomUUID } = require('crypto');

const INVITE_TTL = { game_invite: 120000, rematch_request: 30000 };
function publicNotification(doc, now = Date.now()) {
    const n = doc.toObject ? doc.toObject() : { ...doc };
    const expiresAt = n.expiresAt || (INVITE_TTL[n.type] && new Date(new Date(n.createdAt).getTime() + INVITE_TTL[n.type]));
    const visible = { ...n }; delete visible.dedupeKey; delete visible.email;
    return { ...visible, ...(expiresAt ? { expiresAt } : {}), actionable: n.actionStatus !== 'accepted' && (!expiresAt || new Date(expiresAt).getTime() > now) };
}
function publicReport(doc, admin = false) {
    const r = doc.toObject ? doc.toObject() : { ...doc };
    if (!admin) { delete r.ip; delete r.deviceInfo; }
    r.messages = (r.messages || []).map(({ role, text, createdAt, id }) => ({ role, text, createdAt, id }));
    return r;
}
function createNotificationService({ User, Report, Notification, getSocket = () => null, sendEmail }) {
    const locks = new Map();
    let draining = false, mailing = false;
    async function serial(recipient, work) {
        const key = String(recipient), previous = locks.get(key) || Promise.resolve();
        const task = previous.catch(() => {}).then(work); locks.set(key, task);
        try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
    }
    async function syncUnread(recipient) {
        const count = await Notification.countDocuments({ recipient, read: false });
        await User.updateOne({ _id: recipient }, { $set: { unreadNotifications: count } });
        return count;
    }
    const service = {
        serial,
        async create(recipient, type, title, body = '', data = {}, dedupeKey) {
            return serial(recipient, async () => {
                let n = dedupeKey && await Notification.findOne({ dedupeKey });
                if (!n) {
                    const user = type === 'admin_message' ? await User.findById(recipient).select('notificationPreferences banned') : null;
                    const email = user?.notificationPreferences?.supportEmail && !user.banned ? { state: 'pending', attempts: 0, nextAttemptAt: new Date() } : { state: 'skipped' };
                    const values = { recipient, type, title, body, data, email, ...(dedupeKey ? { dedupeKey } : {}), ...(INVITE_TTL[type] ? { expiresAt: new Date(Date.now() + INVITE_TTL[type]) } : {}) };
                    try { n = await Notification.create(values); }
                    catch (e) { if (e.code !== 11000 || !dedupeKey) throw e; n = await Notification.findOne({ dedupeKey }); }
                }
                // The record is authoritative; a failed cache update must not lose it.
                await syncUnread(recipient).catch(() => console.error('[NOTIFICATION] Unread cache refresh failed'));
                const socket = getSocket(recipient);
                if (socket) socket.emit('notification:new', publicNotification(n));
                return n;
            });
        },
        async markRead(recipient, id) {
            return serial(recipient, async () => {
                const n = await Notification.findOneAndUpdate({ _id: id, recipient }, { $set: { read: true } }, { new: true });
                if (!n) return null;
                await syncUnread(recipient); return publicNotification(n);
            });
        },
        async markAll(recipient, filter = {}) {
            return serial(recipient, async () => {
                const result = await Notification.updateMany({ recipient, read: false, ...filter }, { $set: { read: true } });
                await syncUnread(recipient); return result.modifiedCount;
            });
        },
        async drain() {
            if (draining) return; draining = true;
            try {
                const rows = await Report.find({ 'messages.notificationPending': true }).sort({ createdAt: 1 }).limit(30);
                for (const report of rows) for (const message of report.messages.filter(m => m.notificationPending)) {
                    try {
                        const recipients = message.role === 'admin' ? await User.find({ _id: report.userId }).select('_id').lean() : await User.find({ isAdmin: true, banned: { $ne: true } }).select('_id').lean();
                        if (message.role === 'admin' && !recipients.length) {
                            await Report.updateOne({ _id: report._id }, { $set: { 'messages.$[message].notificationPending': false } }, { arrayFilters: [{ 'message.id': message.id }] });
                            continue;
                        }
                        if (!recipients.length) continue;
                        for (const user of recipients) await service.create(user._id, message.role === 'admin' ? 'admin_message' : 'bug_report_update',
                            (message.role === 'admin' ? 'Reply to your report: ' : 'Support report: ') + report.subject,
                            message.text, { reportId: report._id, message: message.text }, `report:${report._id}:${message.id}:${user._id}`);
                        await Report.updateOne({ _id: report._id }, { $set: { 'messages.$[message].notificationPending': false } }, { arrayFilters: [{ 'message.id': message.id }] });
                    } catch { console.error('[NOTIFICATION] Report delivery deferred'); }
                }
            } finally { draining = false; }
        },
        async deliverEmails() {
            if (mailing || !sendEmail) return; mailing = true;
            try {
                const rows = await Notification.find({ 'email.state': 'pending', 'email.nextAttemptAt': { $lte: new Date() } }).sort({ createdAt: 1 }).limit(10);
                for (const n of rows) {
                    const user = await User.findById(n.recipient).select('email notificationPreferences banned');
                    if (!user || user.banned || !user.notificationPreferences?.supportEmail || n.read) {
                        await Notification.updateOne({ _id: n._id }, { $set: { 'email.state': 'skipped' } }); continue;
                    }
                    try {
                        await sendEmail(user.email, String(n.data.reportId), String(n._id));
                        await Notification.updateOne({ _id: n._id }, { $set: { 'email.state': 'sent', 'email.sentAt': new Date() } });
                    } catch {
                        const attempts = (n.email.attempts || 0) + 1;
                        await Notification.updateOne({ _id: n._id }, { $set: { 'email.attempts': attempts, 'email.nextAttemptAt': new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(attempts, 7))) } });
                        console.error('[NOTIFICATION] Email deferred');
                    }
                }
            } finally { mailing = false; }
        },
        async reply(reportId, role, text, clientRequestId, recipient) {
            const id = clientRequestId || randomUUID();
            const updated = await Report.findOneAndUpdate({ _id: reportId, ...(recipient ? { userId: recipient } : {}), 'messages.id': { $ne: id } },
                { $push: { messages: { id, role, text, notificationPending: true } }, ...(role === 'user' ? { $set: { status: 'in_progress' } } : {}) }, { new: true, runValidators: true });
            const report = updated || await Report.findById(reportId);
            const existing = report?.messages.find(m => m.id === id);
            if (existing && (existing.role !== role || existing.text !== text)) { const e = new Error('Request key already used for a different message'); e.status = 409; throw e; }
            await service.drain(); return report;
        }
    };
    return service;
}
module.exports = { createNotificationService, publicNotification, publicReport, INVITE_TTL };
