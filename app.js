/* TASK COMMAND - LOGIN FIX V8
   Load AFTER supabase-config.js and AFTER app.js.
   It deliberately does not change the page design.
*/
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function showLoginError(message) {
    const box = el('loginError');
    if (box) {
      box.textContent = message || 'Login failed.';
      box.style.display = 'block';
    }
  }

  function normalizeMember(raw) {
    if (!raw) return null;

    // Current Supabase RPC returns { ok, member, sessionToken }.
    if (raw.member) {
      const m = raw.member;
      return {
        id: m.id || m.uuid || m.employee_id || '',
        name: m.name || '',
        login_id: m.login_id || m.employeeId || '',
        role: m.role || 'employee',
        department: m.department || '',
        email: m.email || '',
        phone: m.phone || '',
        profile_photo_url: m.profile_photo_url || m.photo || '',
        is_active: m.is_active !== false
      };
    }

    // Also support a direct row return.
    return {
      id: raw.id || '',
      name: raw.name || '',
      login_id: raw.login_id || raw.employeeId || '',
      role: raw.role || 'employee',
      department: raw.department || '',
      email: raw.email || '',
      phone: raw.phone || '',
      profile_photo_url: raw.profile_photo_url || raw.photo || '',
      is_active: raw.is_active !== false
    };
  }

  async function fixedLogin() {
    const login = (el('loginId')?.value || '').trim();
    const password = el('loginPass')?.value || '';

    if (!login || !password) {
      showLoginError('Please enter login ID and password.');
      return;
    }

    const btn = document.querySelector('#loginScreen button[onclick*="handleLogin"], .login-box button.btn-primary');
    if (btn) {
      btn.disabled = true;
      btn.dataset.oldText = btn.innerHTML;
      btn.innerHTML = 'Logging in...';
    }

    try {
      if (!window.supabaseClient || typeof supabaseClient.rpc !== 'function') {
        throw new Error('Supabase client is not initialized.');
      }

      // IMPORTANT: the verified database function is 2-parameter:
      // login_employee(p_login_id text, p_password text)
      const result = await supabaseClient.rpc('login_employee', {
        p_login_id: login,
        p_password: password
      });

      if (result.error) throw result.error;

      const data = result.data;
      const response = Array.isArray(data) ? data[0] : data;

      if (!response || response.ok === false) {
        throw new Error(response?.message || 'Invalid login ID or password.');
      }

      const member = normalizeMember(response.member || response);

      if (!member || !member.id) {
        throw new Error('Login succeeded but employee data was not returned.');
      }

      const token =
        response.sessionToken ||
        response.session_token ||
        response.token ||
        '';

      // Support the newer APP-based app.js.
      if (window.APP) {
        APP.currentUser = member;
        APP.sessionToken = token;
      }

      localStorage.setItem('taskCommandUserId', member.id);
      if (token) localStorage.setItem('taskCommandSession', token);

      // Support the older app.js variables/functions when present.
      if ('loggedEmployee' in window) window.loggedEmployee = member;
      if ('loggedUser' in window) window.loggedUser = member.name;

      if (window.STORAGE && STORAGE.loggedUser) {
        localStorage.setItem(STORAGE.loggedUser, member.name);
      } else {
        localStorage.setItem('taskCommandUser', member.name);
      }

      // Load the actual employee data before opening dashboard.
      if (typeof window.loadAllData === 'function') {
        await window.loadAllData();
      } else if (typeof window.api === 'function') {
        const fresh = await window.api('getData', {
          employeeId: member.id,
          sessionToken: token
        });
        if (fresh && window.APP) {
          APP.members = fresh.members || [];
          APP.tasks = fresh.tasks || [];
          APP.notifications = fresh.notifications || {};
          APP.announcements = fresh.announcements || [];
          APP.currentUser = fresh.currentUser || member;
        }
      }

      if (typeof window.showApp === 'function') {
        window.showApp();
      } else {
        const loginScreen = el('loginScreen');
        const dashboard = el('appDashboard');
        if (loginScreen) loginScreen.style.display = 'none';
        if (dashboard) dashboard.style.display = 'flex';
      }

      if (typeof window.subscribeRealtime === 'function') window.subscribeRealtime();
      if (typeof window.requestNotificationPermission === 'function') {
        window.requestNotificationPermission();
      }
      if (typeof window.startReminderChecks === 'function') {
        window.startReminderChecks();
      }

    } catch (err) {
      console.error('LOGIN FIX V8:', err);
      showLoginError(err?.message || 'Login failed.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = btn.dataset.oldText || 'LOGIN';
      }
    }
  }

  // Override the broken/old handler.
  window.handleLogin = fixedLogin;

  document.addEventListener('DOMContentLoaded', function () {
    const pass = el('loginPass');
    if (pass) {
      pass.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') fixedLogin();
      });
    }

    const button = document.querySelector('#loginScreen button.btn-primary, .login-box button.btn-primary');
    if (button) {
      // Remove inline-handler ambiguity and use one guaranteed listener.
      button.addEventListener('click', function (e) {
        e.preventDefault();
        fixedLogin();
      });
    }
  });
})();
