
/* TASK COMMAND - LIVE DESKTOP NOTIFICATION FIX V7
   Add this AFTER app.js in index.html:
   <script src="notification-live-fix.js"></script>
*/

(function () {
  'use strict';

  let liveNotificationChannel = null;
  const seenKey = 'taskCommandSeenNotificationIds';

  function currentEmployeeId() {
    try {
      if (typeof me === 'function') {
        const u = me();
        if (u && u.id) return String(u.id);
      }
    } catch (_) {}

    try {
      if (window.APP && APP.currentUser && APP.currentUser.id) {
        return String(APP.currentUser.id);
      }
    } catch (_) {}

    return '';
  }

  function isVisibleToCurrentUser(row) {
    const id = currentEmployeeId();
    if (!id || !row) return false;

    // Notifications are employee-specific.
    return String(row.employee_id || '') === id;
  }

  function rememberNotification(id) {
    if (!id) return false;

    try {
      const arr = JSON.parse(localStorage.getItem(seenKey) || '[]');
      if (arr.includes(String(id))) return false;

      arr.push(String(id));
      while (arr.length > 100) arr.shift();
      localStorage.setItem(seenKey, JSON.stringify(arr));
      return true;
    } catch (_) {
      return true;
    }
  }

  function browserNotify(row) {
    if (!('Notification' in window)) return;

    const title = row.title || 'Task Command';
    const body = row.message || 'You have a new notification.';

    if (Notification.permission === 'granted') {
      try {
        const n = new Notification(title, {
          body,
          icon: 'https://denisha-keshvala.github.io/Taskmanagement/favicon.png',
          tag: 'task-command-' + String(row.id || Date.now()),
          renotify: true
        });

        n.onclick = function () {
          try {
            window.focus();
            n.close();
          } catch (_) {}
        };
      } catch (_) {}
    }
  }

  async function askNotificationPermissionFromUserGesture() {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch (_) {}
    }
  }

  function startLiveNotifications() {
    if (!window.supabaseClient || typeof supabaseClient.channel !== 'function') {
      console.warn('Task Command: Supabase client is not ready for live notifications.');
      return;
    }

    if (liveNotificationChannel) {
      try {
        supabaseClient.removeChannel(liveNotificationChannel);
      } catch (_) {}
    }

    const channelName =
      'task-command-notifications-' +
      Math.random().toString(36).slice(2) +
      '-' + Date.now();

    liveNotificationChannel = supabaseClient
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications'
        },
        function (payload) {
          const row = payload && payload.new ? payload.new : null;
          if (!row || !isVisibleToCurrentUser(row)) return;

          // Prevent duplicate desktop notifications when the app is open
          // in more than one tab.
          if (!rememberNotification(row.id)) return;

          // IMPORTANT: show the desktop notification immediately.
          // Do NOT wait for loadAllData()/refreshRealtime().
          browserNotify(row);

          // Refresh the notification list/UI separately.
          try {
            if (typeof loadAllData === 'function') {
              loadAllData().catch(function (e) {
                console.warn('Notification UI refresh failed:', e);
              });
            }
          } catch (_) {}
        }
      )
      .subscribe(function (status) {
        console.log('Task Command live notification channel:', status);
      });
  }

  function stopLiveNotifications() {
    if (liveNotificationChannel && window.supabaseClient) {
      try {
        supabaseClient.removeChannel(liveNotificationChannel);
      } catch (_) {}
    }
    liveNotificationChannel = null;
  }

  // Permission must be requested from a real user interaction in browsers
  // that restrict automatic permission prompts.
  document.addEventListener(
    'click',
    function () {
      askNotificationPermissionFromUserGesture();
    },
    { once: true, passive: true }
  );

  document.addEventListener(
    'keydown',
    function () {
      askNotificationPermissionFromUserGesture();
    },
    { once: true, passive: true }
  );

  window.addEventListener('beforeunload', stopLiveNotifications);

  // Start after the existing app has initialized Supabase/login state.
  window.addEventListener('load', function () {
    setTimeout(startLiveNotifications, 1200);
  });

  // Reconnect if the browser/network temporarily disconnects.
  window.addEventListener('online', function () {
    setTimeout(startLiveNotifications, 500);
  });

  // Expose helpers for testing.
  window.TaskCommandLiveNotifications = {
    start: startLiveNotifications,
    stop: stopLiveNotifications,
    requestPermission: askNotificationPermissionFromUserGesture
  };
})();
