(function () {
    'use strict';
    const pages = [
        ['overview', '/admin', 'Overview', 'Workspace', 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
        ['users', '/admin/users', 'Players', 'Workspace', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'],
        ['user-reports', '/admin/user-reports', 'Player reports', 'Moderation', 'M4 22V3M4 4c5-5 11 5 16 0v11c-5 5-11-5-16 0'],
        ['reports', '/admin/reports', 'Support inbox', 'Moderation', 'M4 4h16v12h-5l-3 4-3-4H4zM8 8h8M8 12h5'],
        ['bots', '/admin/bots', 'Bots', 'Operations', 'M5 7h14v13H5zM9 12h.01M15 12h.01M9 16h6M12 7V3M2 11v5M22 11v5'],
        ['metrics', '/admin/metrics', 'Analytics', 'Operations', 'M4 20h17M7 16V9M12 16V4M17 16v-5'],
        ['logs', '/admin/logs', 'Activity log', 'Operations', 'M8 4H4v17h16V4h-4M8 2h8v5H8zM8 12h8M8 16h5']
    ];
    const icon = path => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>';
    function init() {
        const main = document.getElementById('adminMain');
        if (!main || document.getElementById('adminSidebar')) return;
        const current = pages.find(page => page[0] === document.body.dataset.adminPage) || pages[0];
        const skip = document.createElement('a'); skip.href = '#adminMain'; skip.className = 'admin-skip'; skip.textContent = 'Skip to content';
        document.body.prepend(skip);
        const sidebar = document.createElement('aside'); sidebar.className = 'admin-sidebar'; sidebar.id = 'adminSidebar';
        sidebar.innerHTML = '<a class="admin-brand" href="/admin" aria-label="PlayQuor administration"><span class="admin-brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="admin-brand-word">PlayQuor<small>Administration</small></span></a>';
        const navigation = document.createElement('nav'); navigation.setAttribute('aria-label', 'Administration');
        let section = '';
        for (const [key, href, label, group, path] of pages) {
            if (group !== section) {
                const heading = document.createElement('div'); heading.className = 'admin-nav-section'; heading.textContent = group;
                navigation.append(heading); section = group;
            }
            const link = document.createElement('a'); link.href = href; link.className = 'admin-nav-link';
            link.innerHTML = icon(path) + '<span>' + label + '</span>';
            if (key === current[0]) link.setAttribute('aria-current', 'page');
            navigation.append(link);
        }
        sidebar.append(navigation);
        const footer = document.createElement('div'); footer.className = 'admin-sidebar-footer';
        footer.innerHTML = '<a href="/">Back to PlayQuor <span aria-hidden="true">↗</span></a>';
        sidebar.append(footer); document.body.prepend(sidebar);
        const backdrop = document.createElement('button'); backdrop.className = 'admin-nav-backdrop'; backdrop.tabIndex = -1;
        backdrop.setAttribute('aria-label', 'Close navigation'); document.body.prepend(backdrop);
        const topbar = document.createElement('header'); topbar.className = 'admin-topbar';
        if (!window.PQNotifications && !document.getElementById('pqNotificationsScript')) {
            const notificationScript = document.createElement('script'); notificationScript.id = 'pqNotificationsScript';
            notificationScript.src = '/js/notifications.js?v=1.0.0';
            // Defer until the topbar exists; do not create another gameplay socket.
            setTimeout(() => document.head.appendChild(notificationScript), 0);
        }
        topbar.innerHTML = '<button class="admin-menu-button" aria-label="Open navigation" aria-controls="adminSidebar" aria-expanded="false">' +
            icon('M4 6h16M4 12h16M4 18h16') + '</button><div class="admin-breadcrumb"><span>' + current[3] + '</span><span aria-hidden="true">/</span><strong>' + current[2] +
            '</strong></div><div class="admin-access">' + icon('M12 3l8 4v6c0 5-8 8-8 8s-8-3-8-8V7zM9 12l2 2 4-4') + '<span>Administration</span></div>';
        main.before(topbar);
        const menu = topbar.querySelector('button');
        const mobile = window.matchMedia('(max-width: 1023px)');
        let navOpen = false;
        function setNavigation(open) {
            navOpen = open && mobile.matches;
            document.body.classList.toggle('admin-nav-open', navOpen);
            menu.setAttribute('aria-expanded', String(navOpen));
            menu.setAttribute('aria-label', navOpen ? 'Close navigation' : 'Open navigation');
            sidebar.setAttribute('aria-hidden', String(mobile.matches && !navOpen));
            main.inert = navOpen || Boolean(currentModal);
            skip.inert = navOpen || Boolean(currentModal);
            if (navOpen) requestAnimationFrame(() => { if (navOpen) sidebar.querySelector('[aria-current]')?.focus(); });
        }
        menu.addEventListener('click', () => setNavigation(!navOpen));
        backdrop.addEventListener('click', () => { setNavigation(false); menu.focus(); });
        navigation.addEventListener('click', event => { if (event.target.closest('a')) setNavigation(false); });
        mobile.addEventListener('change', () => setNavigation(false));

        function wrapTables(root = document) {
            const tables = root.tagName === 'TABLE' ? [root] : root.querySelectorAll('table');
            for (const table of tables) {
                if (table.closest('.admin-table-scroll')) continue;
                const region = document.createElement('div'); region.className = 'admin-table-scroll'; region.tabIndex = 0;
                region.setAttribute('role', 'region');
                region.setAttribute('aria-label', (table.closest('.panel')?.querySelector('h2,h3')?.textContent || current[2]) + ' table');
                table.before(region); region.append(table);
            }
        }
        wrapTables();
        new window.MutationObserver(records => {
            for (const record of records) for (const node of record.addedNodes) {
                if (node.nodeType === 1 && (node.tagName === 'TABLE' || node.querySelector('table'))) wrapTables(node);
            }
        }).observe(main, { childList: true, subtree: true });

        const modals = [...document.querySelectorAll('.modal-overlay')];
        const returnFocus = new WeakMap(), opened = new WeakSet();
        let currentModal = null;
        const visible = modal => window.getComputedStyle(modal).display !== 'none';
        function syncModals() {
            const top = modals.filter(visible).at(-1) || null;
            if (top === currentModal) return;
            let restore;
            if (currentModal && !visible(currentModal)) {
                restore = returnFocus.get(currentModal); opened.delete(currentModal);
            }
            if (top && !opened.has(top)) { opened.add(top); returnFocus.set(top, document.activeElement); }
            currentModal = top;
            document.body.classList.toggle('admin-modal-open', Boolean(top));
            main.inert = Boolean(top) || navOpen; sidebar.inert = Boolean(top); topbar.inert = Boolean(top);
            skip.inert = Boolean(top) || navOpen;
            for (const overlay of modals) overlay.inert = overlay !== top && visible(overlay);
            window.queueMicrotask(() => {
                if (currentModal !== top) return;
                if (top) {
                    const target = restore?.isConnected && top.contains(restore) ? restore : top.querySelector('button,input,select,textarea,a[href]');
                    target?.focus();
                } else if (restore?.isConnected) restore.focus(); else main.focus();
            });
        }
        modals.forEach((overlay, index) => {
            const dialog = overlay.querySelector('.modal'), heading = dialog?.querySelector('h2');
            if (dialog) { dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); }
            if (heading && dialog) { if (!heading.id) heading.id = 'adminDialogTitle' + index; dialog.setAttribute('aria-labelledby', heading.id); }
            overlay.querySelector('.modal-close')?.setAttribute('aria-label', 'Close dialog');
            new window.MutationObserver(syncModals).observe(overlay, { attributes: true, attributeFilter: ['style', 'class'] });
        });
        document.addEventListener('keydown', event => {
            const target = currentModal || (navOpen ? sidebar : null);
            if (event.key === 'Escape' && target) {
                event.preventDefault();
                if (currentModal) currentModal.querySelector('.modal-close')?.click();
                else { setNavigation(false); menu.focus(); }
            }
            if (event.key !== 'Tab' || !target) return;
            const controls = [...target.querySelectorAll('a[href],button,input,select,textarea,[tabindex="0"]')]
                .filter(node => !node.disabled && node.getClientRects().length);
            if (!controls.length) return;
            const first = controls[0], last = controls.at(-1);
            if (event.shiftKey && (document.activeElement === first || !target.contains(document.activeElement))) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !target.contains(document.activeElement))) {
                event.preventDefault(); first.focus();
            }
        });
        document.body.prepend(skip);
        setNavigation(false); syncModals();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
