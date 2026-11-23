(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory;
    else root.AdminAPI = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    const pending = new Set();
    async function fetchAdmin(url, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        const mutation = !['GET', 'HEAD'].includes(method);
        const key = method + ':' + url;
        if (mutation && pending.has(key)) throw new Error('This action is already in progress.');
        const button = root.document?.activeElement;
        const disable = mutation && button?.tagName === 'BUTTON' && !button.disabled;
        if (mutation) pending.add(key);
        if (disable) button.disabled = true;
        try {
            let response;
            try { response = await root.fetch(url, { credentials: 'same-origin', ...options }); }
            catch (cause) { throw new Error('Network error. Check your connection and try again.', { cause }); }
            if (!response.ok) {
                let body;
                try { body = await response.clone().json(); } catch { /* Non-JSON error page. */ }
                const error = new Error(typeof body?.error === 'string' ? body.error :
                    response.status === 401 ? 'Session expired. Sign in again.' :
                    response.status === 403 ? 'Admin access required.' : `Request failed (HTTP ${response.status}).`);
                error.status = response.status;
                throw error;
            }
            return response;
        } finally {
            if (mutation) pending.delete(key);
            if (disable) button.disabled = false;
        }
    }
    return { fetch: fetchAdmin };
});
