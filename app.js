/* TASK COMMAND REPORT EXPORT FIX V10 - PDF single status + valid Excel OpenXML */
let APP={members:[],tasks:[],notifications:{},announcements:[],taskCounter:1001,currentUser:null,filter:'all',sessionToken:''};
let liveRefreshTimer=null;
let selectedAnnouncementType='Announcement';
let isLoading=false;


/* =========================================================
   SUPABASE BRIDGE - replaces Google Apps Script bridge
   Keeps the existing UI and function names unchanged.
   ========================================================= */

function sbError(error) {
  return new Error(error?.message || error?.error_description || 'Supabase request failed.');
}

function getSessionToken(){return APP.sessionToken || localStorage.getItem('taskCommandSession') || '';}

// Keep one status vocabulary in the UI even though Supabase stores
// task_status enum values in kebab-case (in-progress) while the UI shows
// human-readable labels (In Progress).
function normalizeTaskStatus(status){
  const v=String(status ?? '').trim().toLowerCase().replace(/[_-]+/g,' ');
  if(v==='in progress'||v==='progress'||v==='inprogress') return 'In Progress';
  if(v==='completed'||v==='complete'||v==='done') return 'Completed';
  if(v==='pending'||v==='') return 'Pending';
  if(v==='cancelled'||v==='canceled') return 'Cancelled';
  if(v==='overdue') return 'Overdue';
  return String(status || 'Pending').trim() || 'Pending';
}

function statusForDatabase(status){
  const v=normalizeTaskStatus(status);
  if(v==='In Progress') return 'in-progress';
  if(v==='Completed') return 'completed';
  if(v==='Cancelled') return 'cancelled';
  if(v==='Overdue') return 'overdue';
  return 'pending';
}

function normalizeTaskForUi(task){
  if(!task || typeof task!=='object') return task;
  return {...task,status:normalizeTaskStatus(task.status)};
}

function normalizeSupabaseData(data) {
  const out = data || {};
  const notifications = {};
  (out.notifications || []).forEach(n => {
    const user = String(n.user_name || '').trim();
    if (!user) return;
    if (!notifications[user]) notifications[user] = [];
    notifications[user].push({
      message: n.message || '',
      type: n.type || 'Update',
      createdAt: n.created_at || '',
      read: !!n.read
    });
  });
  return {
    members: out.members || [],
    tasks: (out.tasks || []).map(normalizeTaskForUi),
    notifications,
    announcements: out.announcements || [],
    taskCounter: Number(out.task_counter || 1001),
    currentUser: out.current_user || null,
    isOwner: !!out.is_owner
  };
}

async function supabaseCall(action, payload = {}) {
  let rpcName = '';
  let params = {};

  switch (action) {
    case 'login':
      rpcName = 'login_employee';
      params = {
        p_login_id: payload.employeeId || '',
        p_password: payload.password || '',
        p_department: payload.department || ''
      };
      break;

    case 'getData':
      rpcName = 'get_app_data';
      params = { p_employee_id: payload.employeeId || '', p_session_token: payload.sessionToken || getSessionToken() };
      break;

    case 'getLiveUpdates':
      rpcName = 'get_live_updates';
      params = { p_employee_id: payload.employeeId || '', p_session_token: payload.sessionToken || getSessionToken() };
      break;

    case 'updateTaskStatus':
      rpcName = 'update_task_status';
      params = {
        p_employee_id: payload.employeeId || '',
        p_session_token: payload.sessionToken || getSessionToken(),
        p_task_id: payload.taskId || '',
        // Supabase task_status enum uses `in-progress`, not `In Progress`.
        p_status: statusForDatabase(payload.status || 'Pending')
      };
      break;

    case 'createTask':
      rpcName = 'create_task';

      // IMPORTANT:
      // Supabase function signature:
      // create_task(
      //   p_employee_id text,
      //   p_session_token text,
      //   p_task_type text,
      //   p_assigned_to text,
      //   p_priority text,
      //   p_deadline date,
      //   p_reminder text,
      //   p_description text,
      //   p_file_url text,
      //   p_department text,
      //   p_follow_up text
      // )

      params = {
        p_employee_id: String(
          payload.employeeId || APP.currentUser?.employeeId || ''
        ),
        p_session_token: String(
          payload.sessionToken || getSessionToken() || ''
        ),
        p_task_type: String(
          payload.taskType || payload.task_type || ''
        ),
        p_assigned_to: String(
          payload.assignedTo || payload.assigned_to || ''
        ),
        p_priority: String(
          payload.priority || 'Medium'
        ),
        p_deadline:
          payload.deadline ||
          payload.dueDate ||
          payload.due_date ||
          null,
        p_reminder: String(
          payload.reminder || ''
        ),
        p_description: String(
          payload.description || ''
        ),
        p_file_url: String(
          payload.fileUrl || payload.file_url || ''
        ),
        p_department: String(
          payload.taskDepartment ||
          payload.department ||
          'Other'
        ),
        p_follow_up: String(
          payload.followUpTo ||
          payload.followUp ||
          payload.follow_up ||
          ''
        )
      };

      console.log('CREATE TASK RPC:', params);
      break;

    case 'createAnnouncement':
      rpcName = 'create_announcement';
      params = {
        p_employee_id: payload.employeeId || '',
        p_session_token: payload.sessionToken || getSessionToken(),
        p_title: payload.title || '',
        p_description: payload.description || '',
        p_type: payload.type || 'Announcement',
        p_file_url: payload.fileUrl || ''
      };
      break;

    case 'getTaskReport':
      rpcName = 'get_task_report';
      params = {
        p_employee_id: payload.employeeId || '',
        p_session_token: payload.sessionToken || getSessionToken(),
        p_employee: payload.employee || 'ALL',
        p_period: payload.period || 'all'
      };
      break;

    case 'saveAll':
      rpcName = 'save_all';
      params = {
        p_employee_id: payload.employeeId || '',
        p_session_token: payload.sessionToken || getSessionToken(),
        p_members: payload.members || [],
        p_tasks: payload.tasks || [],
        p_notifications: payload.notifications || {},
        p_task_counter: Number(payload.taskCounter || 1001)
      };
      break;

    case 'addEmployee':
      rpcName = 'add_employee';
      params = {
        p_employee_id: payload.employeeId || '',
        p_session_token: payload.sessionToken || getSessionToken(),
        p_name: payload.name || '',
        p_role: payload.role || 'employee',
        p_email: payload.email || '',
        p_phone: payload.phone || '',
        p_department: payload.department || 'Other'
      };
      break;

    case 'updateOwnProfile':
      rpcName = 'update_own_profile';
      params = {
        p_employee_id: payload.employeeId || '',
        p_session_token: payload.sessionToken || getSessionToken(),
        p_email: payload.email || '',
        p_phone: payload.phone || '',
        p_photo: payload.photo || null
      };
      break;

    default:
      throw new Error('Unknown Supabase action: ' + action);
  }

  // IMPORTANT: status changes are written directly to public.tasks.
  // The old implementation depended on an RPC named update_task_status;
  // when that RPC was missing/out-of-sync, the dropdown changed locally
  // but the database never changed. Direct update keeps the UI and DB in
  // one path and still enforces that non-admin users can update only tasks
  // assigned to them.
  if (action === 'updateTaskStatus') {
    const taskId = String(payload.taskId || '').trim();
    const dbStatus = statusForDatabase(payload.status || 'Pending');
    const employeeLogin = String(payload.employeeId || APP.currentUser?.employeeId || '').trim();
    if (!taskId) throw new Error('Task ID is required.');
    if (!employeeLogin) throw new Error('Employee session is missing.');

    let actorId = APP.currentUser?.id || APP.currentUser?.employee_id || '';
    if (!actorId) {
      const ar = await supabaseClient.from('employees').select('id,name,role').eq('login_id', employeeLogin).maybeSingle();
      if (ar.error) throw sbError(ar.error);
      actorId = ar.data?.id || '';
      if (ar.data && !APP.currentUser) APP.currentUser = {...ar.data, employeeId: employeeLogin};
    }
    if (!actorId) throw new Error('Employee not found.');

    let tr = await supabaseClient.from('tasks').select('id,task_id,status,completed_at').eq('task_id', taskId).maybeSingle();
    if (tr.error) throw sbError(tr.error);
    if (!tr.data) {
      // Some older task payloads expose the UUID as `id` instead of task_id.
      tr = await supabaseClient.from('tasks').select('id,task_id,status,completed_at').eq('id', taskId).maybeSingle();
      if (tr.error) throw sbError(tr.error);
    }
    if (!tr.data) throw new Error('Task not found.');

    const actorRole = String(APP.currentUser?.role || '').toLowerCase();
    const admin = actorRole === 'owner' || actorRole === 'admin';
    if (!admin) {
      const ass = await supabaseClient.from('task_assignees').select('id').eq('task_id', tr.data.id).eq('employee_id', actorId).maybeSingle();
      if (ass.error) throw sbError(ass.error);
      if (!ass.data) throw new Error('You can update only your assigned tasks.');
    }

    const ur = await supabaseClient.from('tasks')
      .update({status: dbStatus})
      .eq('id', tr.data.id)
      .select('id,task_id,status,completed_at,updated_at')
      .single();
    if (ur.error) throw sbError(ur.error);

    // Keep task history if the table exists; history failure must not undo a successful status update.
    if (String(tr.data.status || '') !== dbStatus) {
      try {
        await supabaseClient.from('task_activity').insert({
          task_id: tr.data.id, employee_id: actorId, action: 'status_update',
          old_status: String(tr.data.status || ''), new_status: dbStatus
        });
      } catch (_) {}
    }
    return {ok:true, task:ur.data};
  }

  // Login is kept backward-compatible with both database versions:
  // current schema: login_employee(p_login_id, p_password, p_department)
  // older schema: login_employee(p_login_id, p_password)
  let data, error;
  if (action === 'login') {
    const first = await supabaseClient.rpc('login_employee', params);
    data = first.data; error = first.error;
    if (error) {
      const msg = String(error.message || error.details || '').toLowerCase();
      if (msg.includes('function') && msg.includes('login_employee')) {
        const fallback = await supabaseClient.rpc('login_employee', {
          p_login_id: params.p_login_id,
          p_password: params.p_password
        });
        data = fallback.data; error = fallback.error;
      }
    }
  } else {
    const r = await supabaseClient.rpc(rpcName, params);
    data = r.data; error = r.error;
  }
  if (error) throw sbError(error);

  if (action === 'getData' || action === 'getLiveUpdates') {
    return normalizeSupabaseData(data);
  }

  if (action === 'login') {
    return data || { ok: false, message: 'Invalid login.' };
  }

  return data || { ok: true };
}

function api(action, payload = {}) {
  return supabaseCall(action, payload);
}

function direct(name, payload = {}) {
  return supabaseCall(name, payload);
}

async function uploadFile(file, action, nameOverride) {
  if (!file) throw new Error('No file selected.');
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('File is larger than 8 MB.');
  }

  // Owner and Employee can both change their own profile photo.
  // The database/storage policy should still restrict the path to the
  // currently logged-in user.

  const bucket = action === 'uploadPhoto' ? 'avatars' : 'task-attachments';
  const safeName = String(nameOverride || file.name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 100);

  const userPart = APP.currentUser?.employeeId || 'public';
  const path = `${userPart}/${Date.now()}-${safeName}`;

  const { data, error } = await supabaseClient.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined
    });

  if (error) throw sbError(error);

  const { data: publicData } =
    supabaseClient.storage.from(bucket).getPublicUrl(data.path);

  if (!publicData?.publicUrl) {
    throw new Error('Storage uploaded, but public URL was not created.');
  }

  return publicData.publicUrl;
}

async function persist() {
  return api('saveAll', {
    employeeId: APP.currentUser?.employeeId,
    members: APP.members,
    tasks: APP.tasks,
    notifications: APP.notifications,
    taskCounter: APP.taskCounter
  });
}

function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
function safeRich(s){return String(s??'').replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'')}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function initials(name){return String(name||'E').trim().split(/\s+/).map(x=>x[0]).join('').substring(0,2).toUpperCase()||'E'}
function isOwner(m=APP.currentUser){const r=String(m?.role||'').trim().toLowerCase();return r==='owner'||r==='admin'}

function ensureFeatureUI(){
  if(!document.getElementById('tcFeatureStyles')){
    const s=document.createElement('style');
    s.id='tcFeatureStyles';
    s.textContent=`
      .tc-kpi-card{border:2px solid rgba(22,119,255,.38)!important;box-shadow:0 8px 24px rgba(22,119,255,.08)!important}
      .announcement-card{cursor:pointer;transition:.2s;position:relative}
      .announcement-card:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(22,119,255,.14)}
      .announcement-card:after{content:'Click to read full announcement';display:block;margin-top:10px;font-size:11px;font-weight:700;opacity:.78}
      .tc-announcement-modal-card{width:min(980px,96vw)!important;max-height:92vh!important;padding:0!important;overflow:hidden!important}
      .tc-announcement-body{max-height:calc(92vh - 150px);overflow:auto;padding:24px 28px 30px}
      .tc-announcement-body img{max-width:100%;height:auto;border-radius:12px}
      .tc-announcement-body table{max-width:100%;overflow:auto;display:block}
      .notif-item{cursor:pointer;border-radius:10px;padding:10px 12px;margin:4px 0;transition:.15s}
      .notif-item:hover{background:#f1f5f9}
      .notif-unread{background:#eef5ff;font-weight:600}
      .tc-modal{display:none;position:fixed;inset:0;background:rgba(2,8,28,.72);backdrop-filter:blur(8px);z-index:100000;align-items:center;justify-content:center;padding:20px}
      .tc-modal.show{display:flex}
      .tc-modal-card{width:min(720px,96vw);max-height:90vh;overflow:auto;background:#fff;border-radius:24px;box-shadow:0 30px 90px rgba(0,0,0,.35);padding:26px}
      .tc-modal-head{display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:1px solid #e5e7eb;padding-bottom:14px;margin-bottom:16px}
      .tc-modal-close{border:0;width:38px;height:38px;border-radius:50%;cursor:pointer;background:#f1f5f9}
      .tc-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .tc-detail{padding:13px;border:1px solid #e5e7eb;border-radius:12px}
      .tc-detail small{display:block;color:#64748b;text-transform:uppercase;font-size:10px;margin-bottom:4px}
      .tc-detail b{word-break:break-word}
      .team-person{cursor:pointer}
      @media(max-width:600px){.tc-detail-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(s);
  }

  if(!document.getElementById('announcementDetailsModal')){
    const m=document.createElement('div');
    m.id='announcementDetailsModal';m.className='tc-modal';
    m.onclick=e=>{if(e.target===m)closeAnnouncementDetails()};
    m.innerHTML=`<div class="tc-modal-card tc-announcement-modal-card">
      <div class="tc-modal-head" style="padding:20px 28px;margin:0"><div><div id="announcementDetailType" style="color:#1677ff;font-weight:800;font-size:12px"></div><h2 id="announcementDetailTitle" style="margin:5px 0 0"></h2></div><button class="tc-modal-close" onclick="closeAnnouncementDetails()">✕</button></div>
      <div class="tc-announcement-body">
        <div class="tc-detail-grid"><div class="tc-detail"><small>Published By</small><b id="announcementDetailAuthor">—</b></div><div class="tc-detail"><small>Date / Time</small><b id="announcementDetailDate">—</b></div></div>
        <div style="margin-top:18px;padding:20px;border:1px solid #e5e7eb;border-radius:16px;background:#fafbff"><div id="announcementDetailDescription"></div></div>
        <a id="announcementDetailFile" class="btn-primary" style="display:none;margin-top:16px;text-decoration:none;text-align:center" target="_blank">Open Attachment</a>
      </div>
    </div>`;
    document.body.appendChild(m);
  }

  if(!document.getElementById('employeePanelModal')){
    const m=document.createElement('div');
    m.id='employeePanelModal';m.className='tc-modal';
    m.onclick=e=>{if(e.target===m)closeEmployeePanel()};
    m.innerHTML=`<div class="tc-modal-card" style="max-width:560px">
      <div class="tc-modal-head"><h2 style="margin:0">Employee Profile</h2><button class="tc-modal-close" onclick="closeEmployeePanel()">✕</button></div>
      <div style="text-align:center">
        <div id="employeePanelAvatar" style="width:96px;height:96px;border-radius:50%;margin:0 auto 12px;background:#1677ff;color:#fff;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800;overflow:hidden"></div>
        <h2 id="employeePanelName" style="margin:5px 0"></h2><p id="employeePanelRole" style="color:#64748b"></p>
      </div>
      <div class="tc-detail-grid" style="margin-top:18px">
        <div class="tc-detail"><small>Employee ID</small><b id="employeePanelId">—</b></div>
        <div class="tc-detail"><small>Department</small><b id="employeePanelDepartment">—</b></div>
        <div class="tc-detail"><small>Email</small><b id="employeePanelEmail">—</b></div>
        <div class="tc-detail"><small>Phone</small><b id="employeePanelPhone">—</b></div>
      </div>
      <div style="margin-top:16px;color:#64748b;font-size:12px;text-align:center">For security, clicking another employee does not silently log in as that employee.</div>
    </div>`;
    document.body.appendChild(m);
  }

  // Give KPI cards a blue highlighted border without changing the layout.
  document.querySelectorAll('[id*="count"],.kpi-card,.stat-card,.dashboard-kpi').forEach(el=>{
    if(el.closest('.kpi-card,.stat-card,.dashboard-kpi')) el.closest('.kpi-card,.stat-card,.dashboard-kpi').classList.add('tc-kpi-card');
  });
}
async function init(){
  ensureFeatureUI();
  const saved=localStorage.getItem('taskCommandUserId');
  const session=localStorage.getItem('taskCommandSession');
  if(saved&&session){
    APP.sessionToken=session;
    try{
      const fresh=await direct('getData',{employeeId:saved,sessionToken:session});
      if(fresh?.currentUser){
        APP={...APP,...fresh,sessionToken:session};
        startSession(fresh.currentUser);
      }else{
        localStorage.removeItem('taskCommandUserId');
        localStorage.removeItem('taskCommandSession');
      }
    }catch(e){
      localStorage.removeItem('taskCommandUserId');
      localStorage.removeItem('taskCommandSession');
      APP.sessionToken='';
    }
  }
}
async function login(){
  const idEl=document.getElementById('loginEmployeeId');
  const passEl=document.getElementById('loginPassword');
  const depEl=document.getElementById('loginDepartmentSelect');
  const employeeId=String(idEl?.value||'').trim();
  const password=String(passEl?.value||'');
  const department=String(depEl?.value||'').trim();
  const btn=document.querySelector('#loginScreen .btn-primary');
  if(!employeeId||!password||!department){
    showLoginError('Please enter Employee ID, password and select department.');
    return;
  }
  if(!window.supabaseClient || typeof window.supabaseClient.rpc!=='function'){
    showLoginError('Supabase client is not initialized. Check supabase-config.js.');
    return;
  }
  if(btn){btn.disabled=true;btn.dataset.loginText=btn.innerHTML;btn.innerHTML='Logging in...';}
  const finish=()=>{if(btn){btn.disabled=false;btn.innerHTML=btn.dataset.loginText||'LOGIN';}};
  try{
    // Try the current 3-parameter RPC first, then the legacy 2-parameter RPC.
    let r=await window.supabaseClient.rpc('login_employee',{
      p_login_id:employeeId,
      p_password:password,
      p_department:department
    });
    if(r.error){
      const msg=String(r.error.message||'').toLowerCase();
      if(msg.includes('function') && msg.includes('login_employee')){
        r=await window.supabaseClient.rpc('login_employee',{
          p_login_id:employeeId,
          p_password:password
        });
      }
    }
    if(r.error) throw r.error;
    let response=Array.isArray(r.data)?r.data[0]:r.data;
    if(!response || response.ok===false){
      throw new Error(response?.message||'Invalid login ID, password or department.');
    }
    const member=response.member||response.current_user||response.user||response;
    if(!member || !(member.id||member.uuid||member.employee_id||member.employeeId||member.login_id)){
      throw new Error('Login succeeded but employee data was not returned.');
    }
    const normalized={
      ...member,
      id:member.id||member.uuid||member.employee_id||'',
      employeeId:member.employeeId||member.employee_id||member.login_id||employeeId,
      login_id:member.login_id||employeeId,
      name:member.name||employeeId,
      role:member.role||'employee',
      department:member.department||department,
      email:member.email||'',
      phone:member.phone||'',
      photo:member.photo||member.profile_photo_url||'',
      is_active:member.is_active!==false
    };
    APP.currentUser=normalized;
    APP.sessionToken=response.sessionToken||response.session_token||response.token||'';
    localStorage.setItem('taskCommandUserId',normalized.employeeId);
    if(APP.sessionToken) localStorage.setItem('taskCommandSession',APP.sessionToken);
    // Load real app data. If get_app_data is temporarily unavailable, still open the dashboard
    // with the authenticated member rather than leaving the user stuck on login.
    try{
      const fresh=await direct('getData',{employeeId:normalized.employeeId,sessionToken:APP.sessionToken});
      APP={...APP,...fresh,currentUser:fresh.currentUser||normalized,sessionToken:APP.sessionToken};
    }catch(dataErr){
      console.warn('get_app_data after login failed:',dataErr);
      APP.currentUser=normalized;
    }
    startSession(APP.currentUser||normalized);
    if(passEl) passEl.value='';
    showLoginError('');
  }catch(e){
    console.error('LOGIN:',e);
    showLoginError(e?.message||'Login failed. Check ID, password and department.');
  }finally{finish();}
}
// Login button compatibility: index.html calls handleLogin().
// Keep the existing login() implementation and expose it safely.
window.handleLogin = login;

function startSession(m){APP.currentUser=m;APP.filter=isOwner(m)?'all':'my';localStorage.setItem('taskCommandUserId',m.employeeId||'');if(APP.sessionToken)localStorage.setItem('taskCommandSession',APP.sessionToken);document.getElementById('loginScreen').style.display='none';document.getElementById('appDashboard').style.display='flex';applyRoleUI();updateProfileUI();renderAll();loadDirectAnnouncements().then(renderAnnouncements).catch(()=>{});startLiveRefresh();document.getElementById('currentPageTitle').textContent=isOwner(m)?'Dashboard':'My Tasks';document.getElementById('taskTableHeading').textContent=isOwner(m)?'Live Task List':'My Tasks';toast('Welcome, '+m.name)}
function applyRoleUI(){const owner=isOwner();document.querySelectorAll('.owner-only').forEach(el=>el.classList.toggle('hidden-by-role',!owner));document.querySelectorAll('.photo-upload-overlay').forEach(el=>el.style.display='flex');const dash=document.getElementById('dashboardNav');if(dash)dash.classList.toggle('hidden-by-role',!owner);}
function logout(){stopLiveRefresh();localStorage.removeItem('taskCommandUserId');localStorage.removeItem('taskCommandSession');APP.currentUser=null;APP.sessionToken='';document.getElementById('appDashboard').style.display='none';document.getElementById('loginScreen').style.display='flex';document.getElementById('loginEmployeeId').value='';document.getElementById('loginPassword').value='';document.getElementById('loginDepartmentSelect').value=''}
function showLoginError(msg){const e=document.getElementById('loginError');e.textContent=msg;e.style.display='block'}
async function loadData(silent=false){if(!APP.currentUser||isLoading)return;isLoading=true;try{const data=await direct('getData',{employeeId:APP.currentUser.employeeId});APP={...APP,...data};APP.currentUser=data.currentUser||APP.currentUser;await loadDirectAnnouncements();applyRoleUI();renderAll();updateProfileUI();if(!silent)toast('Data refreshed')}catch(e){if(!silent)toast(e.message||e)}finally{isLoading=false}}
async function loadDirectNotifications(){
  try{
    const loginId=String(APP.currentUser?.employeeId||'').trim(); if(!loginId)return;
    let employeeId=APP.currentUser?.id||APP.currentUser?.employee_id||'';
    if(!employeeId){const r=await supabaseClient.from('employees').select('id').eq('login_id',loginId).maybeSingle();if(r.error)throw r.error;employeeId=r.data?.id||'';}
    if(!employeeId)return;
    const r=await supabaseClient.from('notifications').select('id,type,title,message,is_read,created_at').eq('employee_id',employeeId).order('created_at',{ascending:false}).limit(25);
    if(r.error)throw r.error;
    const name=APP.currentUser?.name||loginId;APP.notifications=APP.notifications||{};APP.notifications[name]=(r.data||[]).map(n=>({id:n.id,type:n.type||'Update',title:n.title||n.type||'Notification',message:n.message||'',createdAt:n.created_at||'',read:!!n.is_read}));
  }catch(e){console.warn('Direct notification refresh failed:',e)}
}

async function loadDirectAnnouncements(){
  try{
    if(!APP.currentUser)return;
    const r=await supabaseClient
      .from('announcements')
      .select('id,title,description,announcement_type,created_by,attachment_url,attachment_name,is_active,created_at,updated_at')
      .eq('is_active',true)
      .order('created_at',{ascending:false});
    if(r.error)throw r.error;
    const rows=r.data||[];
    const creatorIds=[...new Set(rows.map(a=>a.created_by).filter(Boolean))];
    let creatorMap={};
    if(creatorIds.length){
      const er=await supabaseClient.from('employees').select('id,name').in('id',creatorIds);
      if(!er.error)(er.data||[]).forEach(e=>creatorMap[e.id]=e.name);
    }
    APP.announcements=rows.map(a=>({
      id:a.id,
      title:a.title||'Announcement',
      description:a.description||'',
      type:a.announcement_type||'Announcement',
      createdByName:creatorMap[a.created_by]||'Admin',
      createdAt:a.created_at||a.updated_at||'',
      fileUrl:a.attachment_url||'',
      fileName:a.attachment_name||''
    }));
  }catch(e){console.warn('Direct announcement refresh failed:',e)}
}
async function loadLive(silent=true){if(!APP.currentUser||isLoading)return;isLoading=true;try{const data=await direct('getLiveUpdates',{employeeId:APP.currentUser.employeeId});APP.tasks=(data.tasks||[]).map(normalizeTaskForUi);APP.notifications=data.notifications||{};APP.announcements=data.announcements||APP.announcements;await loadDirectNotifications();await loadDirectAnnouncements();renderDashboardStats();renderTasks();renderMembers();renderNotifications();renderAnnouncements();if(!silent)toast('Updated')}catch(e){console.warn('Live update failed:',e);await loadDirectNotifications();await loadDirectAnnouncements();renderDashboardStats();renderTasks();renderNotifications();renderAnnouncements()}finally{isLoading=false}}
function startLiveRefresh(){stopLiveRefresh();liveRefreshTimer=setInterval(()=>{if(document.visibilityState==='visible'){renderGreeting();loadLive(true)}},3000)}
function stopLiveRefresh(){if(liveRefreshTimer)clearInterval(liveRefreshTimer);liveRefreshTimer=null}
function renderAll(){populateAssignees();renderDashboardStats();renderGreeting();renderTasks();renderMembers();renderTeamList();renderNotifications();renderAnnouncements();renderReportSummary()}
function populateAssignees(){const selects=[document.getElementById('fullAssignee'),document.getElementById('quickAssignee'),document.getElementById('fullFollowUp')];selects.forEach(sel=>{if(!sel)return;const old=sel.multiple?getSelectedAssignees():sel.value;const prefix=sel.id==='fullFollowUp'?'<option value="">-- No Follow-up --</option>':'<option value="">-- Select Member --</option>';sel.innerHTML=prefix+APP.members.map(m=>`<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join('');if(Array.isArray(old))old.forEach(v=>{const o=Array.from(sel.options).find(x=>String(x.value).toLowerCase()===String(v).toLowerCase());if(o)o.selected=true});else if(old)sel.value=old});renderAssigneePicker();const report=document.getElementById('reportEmployee');if(report){const old=report.value;report.innerHTML='<option value="ALL">All Employees</option>'+APP.members.map(m=>`<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join('');if(isOwner()){report.disabled=false;if(old)report.value=old}else{report.innerHTML=`<option value="${escapeHtml(APP.currentUser?.name||'')}">${escapeHtml(APP.currentUser?.name||'My Tasks')}</option>`;report.value=APP.currentUser?.name||'';report.disabled=true}}}
function switchTaskFilter(filter,title,el){if(!isOwner()&&filter==='all'){filter='my';title='My Tasks'}APP.filter=filter;document.getElementById('currentPageTitle').textContent=title;document.getElementById('taskTableHeading').textContent=title==='Dashboard'?'Live Task List':title;document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));if(el)el.classList.add('active');showPage('dashboard-page');renderTasks();closeSidebar()}
function switchPage(id,title,el){if(id==='add-member-page'&&!isOwner()){toast('Member management is Owner only.');return}document.getElementById('currentPageTitle').textContent=title;document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));if(el)el.classList.add('active');showPage(id);closeSidebar()}
function showPage(id){document.querySelectorAll('.modal-page').forEach(x=>x.classList.remove('active'));document.getElementById(id)?.classList.add('active')}
function closeSidebar(){document.getElementById('sidebar').classList.remove('open');document.getElementById('sidebarOverlay').classList.remove('active')}
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open');document.getElementById('sidebarOverlay').classList.toggle('active')}
function renderTasks(){
  let tasks=[...(APP.tasks||[])];const me=APP.currentUser?.name;
  if(!isOwner())tasks=tasks.filter(t=>taskAssignedToMe(t,me));
  else if(APP.filter==='my')tasks=tasks.filter(t=>taskAssignedToMe(t,me));
  if(APP.filter==='in-progress')tasks=tasks.filter(t=>normalizeTaskStatus(t.status)==='In Progress');
  if(APP.filter==='pending')tasks=tasks.filter(t=>normalizeTaskStatus(t.status)==='Pending');
  if(APP.filter==='open')tasks=tasks.filter(t=>normalizeTaskStatus(t.status)!=='Completed');
  if(APP.filter==='completed')tasks=tasks.filter(t=>normalizeTaskStatus(t.status)==='Completed');
  const body=document.getElementById('dashboardTaskTable'),mobile=document.getElementById('mobileTaskList');
  if(!tasks.length){body.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:30px">No tasks found.</td></tr>';mobile.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:25px">No tasks found.</div>';return}
  body.innerHTML=tasks.map(t=>{const overdue=t.deadline&&new Date(t.deadline+'T23:59:59')<new Date()&&String(t.status).toLowerCase()!=='completed';const p=String(t.priority||'Medium').toLowerCase();const status=normalizeTaskStatus(t.status);return `<tr class="task-row" onclick="openTaskDetails('${escapeHtml(t.id)}')"><td><b>${escapeHtml(t.id)}</b></td><td>${escapeHtml(t.taskType)}<div style="font-size:10px;color:var(--text-muted);margin-top:3px">${escapeHtml(t.taskDepartment||t.department||'Other')}</div></td><td>${escapeHtml(taskAssignedToText(t))}</td><td><span class="badge badge-${p}">${escapeHtml(t.priority)}</span></td><td>${escapeHtml(t.deadline||'—')}${overdue?' <span class="status-overdue">OVERDUE</span>':''}</td><td onclick="event.stopPropagation()"><select onchange="changeTaskStatus('${escapeHtml(t.id)}',this.value)" style="padding:5px;border:1px solid var(--border);border-radius:6px"><option ${status==='Pending'?'selected':''}>Pending</option><option ${status==='In Progress'?'selected':''}>In Progress</option><option ${status==='Completed'?'selected':''}>Completed</option></select></td><td>${escapeHtml(t.completedAt||'—')}</td><td onclick="event.stopPropagation()">${t.fileUrl?`<a class="btn-sm btn-success" href="${escapeHtml(t.fileUrl)}" target="_blank"><i class="fas fa-paperclip"></i></a>`:''}${isOwner()?`<button class="btn-sm btn-edit" onclick="editTask('${escapeHtml(t.id)}')"><i class="fas fa-pen"></i></button><button class="btn-sm btn-delete" onclick="deleteTask('${escapeHtml(t.id)}')"><i class="fas fa-trash"></i></button>`:''}</td></tr>`}).join('');
  mobile.innerHTML=tasks.map(t=>{const overdue=t.deadline&&new Date(t.deadline+'T23:59:59')<new Date()&&String(t.status).toLowerCase()!=='completed';const status=normalizeTaskStatus(t.status);return `<div class="mobile-task-card" onclick="openTaskDetails('${escapeHtml(t.id)}')"><div class="mobile-task-top"><div><div class="mobile-task-title">${escapeHtml(t.taskType)}</div><div class="mobile-task-id">${escapeHtml(t.id)} • ${escapeHtml(taskAssignedToText(t))} • ${escapeHtml(t.taskDepartment||t.department||'Other')}</div></div><span class="badge badge-${String(t.priority||'Medium').toLowerCase()}">${escapeHtml(t.priority)}</span></div><div class="mobile-task-meta"><div><span>Deadline</span><b>${escapeHtml(t.deadline||'—')}</b>${overdue?' <span class="status-overdue">OVERDUE</span>':''}</div><div><span>Assigned By</span><b>${escapeHtml(t.createdByName||'—')}</b></div></div><div class="mobile-task-bottom" onclick="event.stopPropagation()"><select onchange="changeTaskStatus('${escapeHtml(t.id)}',this.value)"><option ${status==='Pending'?'selected':''}>Pending</option><option ${status==='In Progress'?'selected':''}>In Progress</option><option ${status==='Completed'?'selected':''}>Completed</option></select><button onclick="openTaskDetails('${escapeHtml(t.id)}')"><i class="fas fa-eye"></i></button></div></div>`}).join('');
  renderDashboardStats();
}
async function changeTaskStatus(id,status){
  const t=APP.tasks.find(x=>String(x.id)===String(id));
  if(!t)return;
  const next=normalizeTaskStatus(status);
  const old={status:t.status,completedAt:t.completedAt};
  t.status=next;
  t.completedAt=next==='Completed'?new Date().toISOString():'';
  renderDashboardStats();
  renderTasks();
  try{
    await api('updateTaskStatus',{employeeId:APP.currentUser.employeeId,taskId:id,status:next});
    toast('Task status updated');
    // Reload the authoritative DB value so table, filters and KPI all stay in sync.
    await loadLive(true);
  }catch(e){
    t.status=old.status;
    t.completedAt=old.completedAt;
    renderDashboardStats();
    renderTasks();
    toast(e.message||String(e));
  }
}
function openTaskDetails(id){const t=APP.tasks.find(x=>x.id===id);if(!t)return;document.getElementById('detailTaskId').textContent=t.id||'TASK';document.getElementById('detailTaskTitle').textContent=t.taskType||'Task Details';document.getElementById('detailAssignedTo').textContent=taskAssignedToText(t)||'—';document.getElementById('detailAssignedBy').textContent=t.createdByName||t.createdBy||'—';document.getElementById('detailFollowUp').textContent=t.followUpTo||'—';document.getElementById('detailDepartment').textContent=t.taskDepartment||t.department||'—';document.getElementById('detailPriority').textContent=t.priority||'—';document.getElementById('detailDeadline').textContent=t.deadline||'—';document.getElementById('detailStatus').textContent=t.status||'—';document.getElementById('detailCreated').textContent=t.createdAt?new Date(t.createdAt).toLocaleString():'—';document.getElementById('detailReminder').textContent=t.reminder||'—';document.getElementById('detailCompleted').textContent=t.completedAt?new Date(t.completedAt).toLocaleString():'—';document.getElementById('detailDescription').innerHTML=safeRich(t.description)||'<span style="color:var(--text-muted)">No description provided.</span>';const a=document.getElementById('detailFile');a.style.display=t.fileUrl?'inline-block':'none';if(t.fileUrl)a.href=t.fileUrl;document.getElementById('taskDetailsModal').classList.add('show')}
function closeTaskDetails(){document.getElementById('taskDetailsModal').classList.remove('show')}
function editTask(id){if(!isOwner())return;const t=APP.tasks.find(x=>x.id===id);if(!t)return;document.getElementById('editTaskId').value=t.id;document.getElementById('fullTaskDepartment').value=t.taskDepartment||t.department||'';document.getElementById('fullTaskType').value=t.taskType;setSelectedAssignees(t.assignedTo);document.getElementById('fullPriority').value=t.priority;document.getElementById('fullDeadline').value=t.deadline||'';document.getElementById('fullReminder').value=t.reminder||'';document.getElementById('fullFollowUp').value=t.followUpTo||'';document.getElementById('fullDescription').innerHTML=t.description||'';document.getElementById('taskFormTitle').innerHTML='<i class="fas fa-pen"></i> Edit Task';document.getElementById('saveTaskBtn').innerHTML='<i class="fas fa-save"></i> Update Task';showPage('assign-task-page');document.getElementById('currentPageTitle').textContent='Edit Task'}
async function deleteTask(id){if(!isOwner()||!confirm('Delete this task?'))return;APP.tasks=APP.tasks.filter(t=>t.id!==id);await persist();renderTasks();toast('Task deleted')}
function getSelectedAssignees(){const sel=document.getElementById('fullAssignee');if(!sel)return [];return Array.from(sel.selectedOptions).map(o=>o.value).filter(Boolean)}
function renderAssigneePicker(){const menu=document.getElementById('multiAssigneeMenu');if(!menu)return;const selected=new Set(getSelectedAssignees().map(x=>String(x).toLowerCase()));if(!APP.members.length){menu.innerHTML='<div class="assignee-empty">No team members available.</div>';updateAssigneePickerLabel();return}menu.innerHTML=APP.members.map(m=>{const name=String(m.name||'').trim();if(!name)return '';const checked=selected.has(name.toLowerCase())?'checked':'';return `<label class="assignee-option"><input type="checkbox" value="${escapeHtml(name)}" ${checked} onchange="onAssigneeCheckboxChange(this)"><span>${escapeHtml(name)}</span></label>`}).join('');updateAssigneePickerLabel()}
function updateAssigneePickerLabel(){const names=getSelectedAssignees();const text=document.getElementById('multiAssigneeText');const count=document.getElementById('assigneeSelectedCount');if(!text||!count)return;if(!names.length){text.textContent='-- Select Member --';count.innerHTML='<i class="fas fa-users"></i> Select one or more employees';return}text.textContent=names.length===1?names[0]:names.length+' employees selected';count.innerHTML='<i class="fas fa-check-circle"></i> '+names.length+' employee'+(names.length===1?'':'s')+' selected'}
function onAssigneeCheckboxChange(cb){const sel=document.getElementById('fullAssignee');const option=Array.from(sel.options).find(o=>String(o.value).toLowerCase()===String(cb.value).toLowerCase());if(option)option.selected=cb.checked;updateAssigneePickerLabel()}
function toggleAssigneePicker(e){if(e)e.stopPropagation();const wrap=document.getElementById('multiAssignee');if(wrap)wrap.classList.toggle('open')}
function closeAssigneePicker(){const wrap=document.getElementById('multiAssignee');if(wrap)wrap.classList.remove('open')}
function setSelectedAssignees(value){const names=Array.isArray(value)?value:String(value||'').split(/\s*[,|]\s*/).map(x=>x.trim()).filter(Boolean);const sel=document.getElementById('fullAssignee');if(!sel)return;Array.from(sel.options).forEach(o=>o.selected=names.some(n=>String(n).toLowerCase()===String(o.value).toLowerCase()));renderAssigneePicker();}

function taskAssignees(t){
  if(Array.isArray(t.assignedTo)) return t.assignedTo;
  return String(t.assignedTo||'').split(/\s*[,|]\s*/).map(x=>x.trim()).filter(Boolean);
}
function taskAssignedToText(t){ return taskAssignees(t).join(', '); }
function taskAssignedToMe(t,name){ return taskAssignees(t).some(x=>String(x).trim().toLowerCase()===String(name||'').trim().toLowerCase()); }
async function submitFullTask(e){e.preventDefault();const id=document.getElementById('editTaskId').value;const payload={employeeId:APP.currentUser.employeeId,taskDepartment:document.getElementById('fullTaskDepartment').value,taskType:document.getElementById('fullTaskType').value,assignedTo:getSelectedAssignees().join(', '),followUpTo:document.getElementById('fullFollowUp').value,priority:document.getElementById('fullPriority').value,deadline:document.getElementById('fullDeadline').value,reminder:document.getElementById('fullReminder').value,description:document.getElementById('fullDescription').innerHTML};if(!payload.taskDepartment){toast('Please select a department.');return}if(!payload.assignedTo){toast('Please select at least one team member.');return}const f=document.getElementById('fullTaskFile').files[0];try{if(f)payload.fileUrl=await uploadFile(f,'uploadTaskFile');if(id&&isOwner()){const t=APP.tasks.find(x=>x.id===id);Object.assign(t,payload,{id:id,createdBy:t.createdBy,createdByName:t.createdByName,department:payload.taskDepartment,taskDepartment:payload.taskDepartment,updatedAt:new Date().toISOString()});await persist();toast('Task updated')}else{await api('createTask',payload);toast(taskAssignees({assignedTo:payload.assignedTo}).includes(APP.currentUser.name)?'Task created':'Task assigned successfully')}resetTaskForm();await loadData(true);showPage('dashboard-page');document.getElementById('currentPageTitle').textContent=isOwner()?'Dashboard':'My Tasks'}catch(err){toast(err.message||String(err))}}
async function createQuickTask(){const title=document.getElementById('quickTitle').value.trim(),assignee=document.getElementById('quickAssignee').value,due=document.getElementById('quickDueDate').value,department=document.getElementById('quickDepartment').value;if(!title||!assignee||!due||!department){toast('Enter title, department, member and due date');return}try{await api('createTask',{employeeId:APP.currentUser.employeeId,taskType:title,taskDepartment:department,assignedTo:assignee,priority:document.getElementById('quickPriority').value,deadline:due,reminder:'',description:'',fileUrl:''});document.getElementById('quickTitle').value='';document.getElementById('quickDepartment').value='';await loadData(true);toast('Task added')}catch(e){toast(e.message||String(e))}}
function resetTaskForm(){document.getElementById('editTaskId').value='';document.getElementById('fullTaskDepartment').value='';document.getElementById('fullTaskType').value='';Array.from(document.getElementById('fullAssignee').options).forEach(o=>o.selected=false);renderAssigneePicker();closeAssigneePicker();document.getElementById('fullFollowUp').value='';document.getElementById('fullPriority').value='Medium';document.getElementById('fullDeadline').value='';document.getElementById('fullReminder').value='';document.getElementById('fullDescription').innerHTML='';document.getElementById('fullTaskFile').value='';document.getElementById('taskFormTitle').innerHTML='<i class="fas fa-tasks"></i> Assign New Task';document.getElementById('saveTaskBtn').innerHTML='<i class="fas fa-paper-plane"></i> Assign Task'}
function getCurrentUserTasks(){
  const all=Array.isArray(APP.tasks)?APP.tasks:[];
  if(isOwner()) return all;
  const name=APP.currentUser?.name||'';
  return all.filter(t=>taskAssignedToMe(t,name));
}
function renderDashboardStats(){
  // Owner/Admin sees the company-wide totals. Employees see ONLY tasks
  // actually assigned to the currently logged-in employee.
  const all=getCurrentUserTasks();
  const open=all.filter(t=>normalizeTaskStatus(t.status)!=='Completed').length;
  const pending=all.filter(t=>normalizeTaskStatus(t.status)==='Pending').length;
  const progress=all.filter(t=>normalizeTaskStatus(t.status)==='In Progress').length;
  const completed=all.filter(t=>normalizeTaskStatus(t.status)==='Completed').length;
  [['countOpen',open],['countPending',pending],['countProgress',progress],['countCompleted',completed]].forEach(([id,n])=>{
    const el=document.getElementById(id);if(el)el.textContent=n;
  });
}
function renderGreeting(){const m=APP.currentUser;if(!m)return;const h=new Date().getHours();const greeting=h<12?'Good Morning':h<17?'Good Afternoon':'Good Evening';const el=document.getElementById('greetingText');const sub=document.getElementById('greetingSubtext');const dept=document.getElementById('dashboardDepartment');if(el)el.textContent=greeting+', '+m.name+' 👋';if(sub)sub.textContent=isOwner(m)?'Here is your team task overview for today.':'Here is your personal task overview for today.';if(dept)dept.textContent='Department: '+(m.department||'Other')}
function openCountDetails(type){let filter='my';let title='My Tasks';if(type==='completed'){filter='completed';title='Completed'}else if(type==='in-progress'){filter='in-progress';title='In Progress'}else if(type==='pending'){filter='pending';title='Pending'}else if(type==='open'){filter='open';title='Open Tasks'}APP.filter=filter;document.getElementById('currentPageTitle').textContent=title;document.getElementById('taskTableHeading').textContent=title;showPage('dashboard-page');renderTasks()}

function renderMembers(){const body=document.getElementById('memberTableBody');if(!body)return;body.innerHTML=APP.members.map((m,i)=>{const count=APP.tasks.filter(t=>taskAssignedToMe(t,m.name)&&String(t.status).toLowerCase()==='completed').length;return `<tr><td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.role)}</td><td>${escapeHtml(m.email)}</td><td>${escapeHtml(m.phone)}</td><td>${escapeHtml(m.department||'—')}</td><td><b>${count}</b></td><td>${isOwner()?`<button class="btn-sm btn-edit" onclick="editMember(${i})">Edit</button><button class="btn-sm btn-delete" onclick="deleteMember(${i})">Delete</button>`:'View only'}</td></tr>`}).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No members yet.</td></tr>'}
function renderTeamList(){const el=document.getElementById('teamList');if(!el)return;el.innerHTML=APP.members.map(m=>`<div class="team-person"><div class="team-avatar">${m.photo?`<img src="${escapeHtml(m.photo)}">`:initials(m.name)}</div><div><h4>${escapeHtml(m.name)}</h4><p>${escapeHtml(m.role||'Team Member')}</p><span class="dept">${escapeHtml(m.department||'Other')}</span></div></div>`).join('')||'<p style="color:var(--text-muted)">No team members.</p>'}
async function saveMember(e){
  e.preventDefault();
  if(!isOwner()){toast('Only the Owner can manage members.');return}
  const i=Number(document.getElementById('editMemberIndex').value);
  const name=document.getElementById('memberName').value.trim();
  const role=document.getElementById('memberRole').value.trim() || 'employee';
  const email=document.getElementById('memberEmail').value.trim();
  const phone=document.getElementById('memberPhone').value.trim();
  const department=document.getElementById('memberDepartment').value || 'Other';
  if(!name||!role||!email||!phone){toast('Please fill all member details.');return}
  const btn=document.getElementById('saveMemberBtn');
  if(btn)btn.disabled=true;
  try{
    if(i>=0){
      const old=APP.members[i];
      if(!old?.id)throw new Error('Member database ID is missing. Refresh the page and try again.');
      const {error}=await supabaseClient.from('employees')
        .update({name,role,email,phone,department,updated_at:new Date().toISOString()})
        .eq('id',old.id);
      if(error)throw sbError(error);
      await loadData(true);
      toast('Member updated successfully');
    }else{
      const result=await api('addEmployee',{employeeId:APP.currentUser?.employeeId||'',sessionToken:getSessionToken(),name,role,email,phone,department});
      if(result && result.ok===false)throw new Error(result.message||'Member could not be added.');
      const added=result?.member||result?.data?.member||result;
      await loadData(true);
      const generatedId=added?.employeeId||added?.login_id||name.toLowerCase().replace(/\s+/g,'');
      const generatedPassword=added?.password||generatedId+'@123';
      showMemberSuccessPopup({name,employeeId:generatedId,password:generatedPassword,department,role,email});
    }
    e.target.reset();
    document.getElementById('editMemberIndex').value='-1';
    document.getElementById('memberFormTitle').innerHTML='<i class="fas fa-user-plus"></i> Add New Team Member';
    document.getElementById('saveMemberBtn').textContent='Save Member';
  }catch(err){
    console.error('SAVE MEMBER ERROR',err);
    const msg=String(err?.message||err||'Member could not be added.');
    if(/gen_salt|add_employee/i.test(msg)){
      toast('Member add database fix is required. Run FIX_MEMBER_ADD_GEN_SALT.sql in Supabase.');
    }else{
      toast(msg);
    }
  }finally{if(btn)btn.disabled=false}
}

function showMemberSuccessPopup(m){
  let modal=document.getElementById('memberSuccessModal');
  if(!modal){
    modal=document.createElement('div');modal.id='memberSuccessModal';modal.className='tc-modal';
    modal.innerHTML=`<div class="tc-modal-card" style="max-width:560px">
      <div class="tc-modal-head"><div><div style="color:#1677ff;font-weight:800;font-size:12px">SUCCESS</div><h2 style="margin:5px 0 0">Member Added Successfully</h2></div><button class="tc-modal-close" onclick="closeMemberSuccessPopup()">✕</button></div>
      <div style="padding:14px;background:#f8fbff;border:2px solid #173b8f;border-radius:14px"><div class="tc-detail-grid">
        <div class="tc-detail"><small>Name</small><b id="memberSuccessName"></b></div>
        <div class="tc-detail"><small>Employee ID</small><b id="memberSuccessId"></b></div>
        <div class="tc-detail"><small>Password</small><b id="memberSuccessPassword"></b></div>
        <div class="tc-detail"><small>Department</small><b id="memberSuccessDepartment"></b></div>
        <div class="tc-detail"><small>Role</small><b id="memberSuccessRole"></b></div>
        <div class="tc-detail"><small>Email</small><b id="memberSuccessEmail"></b></div>
      </div></div><button class="btn-primary" style="width:100%;margin-top:16px" onclick="closeMemberSuccessPopup()">Done</button>
    </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('memberSuccessName').textContent=m.name;
  document.getElementById('memberSuccessId').textContent=m.employeeId;
  document.getElementById('memberSuccessPassword').textContent=m.password;
  document.getElementById('memberSuccessDepartment').textContent=m.department;
  document.getElementById('memberSuccessRole').textContent=m.role;
  document.getElementById('memberSuccessEmail').textContent=m.email;
  modal.classList.add('show');
}
function closeMemberSuccessPopup(){document.getElementById('memberSuccessModal')?.classList.remove('show')}

function editMember(i){if(!isOwner())return;const m=APP.members[i];document.getElementById('editMemberIndex').value=i;document.getElementById('memberName').value=m.name;document.getElementById('memberRole').value=m.role;document.getElementById('memberEmail').value=m.email;document.getElementById('memberPhone').value=m.phone;document.getElementById('memberDepartment').value=String(m.department||'').toLowerCase()}
async function deleteMember(i){
  if(!isOwner()||!confirm('Delete this member?'))return;
  const m=APP.members[i];
  if(!m?.id){toast('Member database ID is missing. Refresh and try again.');return}
  try{
    const {error}=await supabaseClient.from('employees').update({is_active:false,updated_at:new Date().toISOString()}).eq('id',m.id);
    if(error)throw sbError(error);
    await loadData(true);toast('Member deactivated successfully');
  }catch(e){toast(e.message||String(e))}
}
function renderNotifications(){const list=APP.notifications?.[APP.currentUser?.name]||[];const unread=list.filter(x=>!x.read).length;const count=document.getElementById('notifCount');const box=document.getElementById('notifList');if(count)count.textContent=unread;if(!box)return;box.innerHTML=list.length?list.slice(0,25).map((n,i)=>`<div class="notif-item ${n.read?'':'notif-unread'}" onclick="openNotificationDetails(${i})"><b>${escapeHtml(n.title||n.type||'Update')}</b>${n.message?` — ${escapeHtml(n.message)}`:''}<br><small style="color:var(--text-muted)">${n.createdAt?new Date(n.createdAt).toLocaleString():''}</small></div>`).join(''):'<p style="font-size:.75rem;color:var(--text-muted);text-align:center;padding:10px">No new notifications</p>'}
function toggleNotificationDropdown(){const box=document.getElementById('notifDropdown');if(!box)return;box.classList.toggle('show');renderNotifications()}
function openNotificationDetails(i){const list=APP.notifications?.[APP.currentUser?.name]||[];const n=list[i];if(!n)return;n.read=true;renderNotifications();if(n.id){supabaseClient.from('notifications').update({is_read:true}).eq('id',n.id).then(()=>{}).catch(()=>{})}toast((n.title||n.type||'Notification')+': '+(n.message||''))}
function renderAnnouncements(){const list=APP.announcements||[];const el=document.getElementById('announcementList');if(!el)return;if(!list.length){el.innerHTML='<div class="announcement-empty">No announcements yet. Stay tuned for company updates.</div>';return}el.innerHTML=list.map((a,i)=>`<div class="announcement-card" onclick="openAnnouncementDetails(${i})"><div class="ann-type">${escapeHtml(a.type||'Announcement')} • ${escapeHtml(a.createdByName||'Admin')}</div><h4>${escapeHtml(a.title)}</h4><div class="ann-desc">${safeRich(a.description)}</div><small>${a.createdAt?new Date(a.createdAt).toLocaleString():''}${a.fileUrl?` • <a href="${escapeHtml(a.fileUrl)}" target="_blank" onclick="event.stopPropagation()" style="color:#fff;text-decoration:underline">${escapeHtml(a.fileName||'Attachment')}</a>`:''}</small></div>`).join('')}
function openAnnouncementDetails(i){const a=(APP.announcements||[])[i];if(!a)return;ensureFeatureUI();document.getElementById('announcementDetailType').textContent=(a.type||'Announcement')+' • '+(a.createdByName||'Admin');document.getElementById('announcementDetailTitle').textContent=a.title||'Announcement';document.getElementById('announcementDetailAuthor').textContent=a.createdByName||'Admin';document.getElementById('announcementDetailDate').textContent=a.createdAt?new Date(a.createdAt).toLocaleString():'—';document.getElementById('announcementDetailDescription').innerHTML=safeRich(a.description||'');const file=document.getElementById('announcementDetailFile');if(a.fileUrl){file.href=a.fileUrl;file.style.display='block'}else{file.style.display='none';file.removeAttribute('href')}document.getElementById('announcementDetailsModal').classList.add('show')}
function closeAnnouncementDetails(){document.getElementById('announcementDetailsModal')?.classList.remove('show')}

async function downloadTaskReport(kind){
  // Single report entry point. The premium exporter below owns PDF/Excel generation.
  if(typeof window.downloadTaskReport === 'function' && window.downloadTaskReport !== downloadTaskReport){
    return window.downloadTaskReport(kind === 'xlsx' ? 'excel' : kind);
  }
}

function updateProfileUI(){const m=APP.currentUser;if(!m)return;document.getElementById('userProfileName').textContent=m.name;document.getElementById('sidebarUserName').textContent=m.name;document.getElementById('sidebarUserRole').textContent=m.role||'Active User';document.getElementById('sidebarUserRole2').textContent=m.role||'Active User';document.getElementById('sidebarUserDepartment').textContent=m.department?('Department: '+m.department):'';document.getElementById('headerUserDepartment').textContent=m.department?('Department: '+m.department):'';const ld=document.getElementById('loginDepartment');if(ld){ld.textContent=m.department?'Department: '+m.department:'';ld.style.display=m.department?'block':'none'}setAvatar('headerAvatar',m);setAvatar('sidebarAvatar',m);fillProfile(m)}
function setAvatar(id,m){const el=document.getElementById(id);if(!el)return;if(m.photo)el.innerHTML=`<img src="${escapeHtml(m.photo)}">`;else el.textContent=initials(m.name)}
function fillProfile(m){document.getElementById('profileName').textContent=m.name;document.getElementById('profileRole').textContent=m.role||'Active User';document.getElementById('profileRole2').textContent=m.role||'Not added';document.getElementById('profilePhone').textContent=m.phone||'Not added';document.getElementById('profileEmail').textContent=m.email||'Not added';document.getElementById('profileEmployeeId').textContent=m.employeeId||'Not added';setAvatar('profileBigAvatar',m)}
function openProfileModal(){if(APP.currentUser){fillProfile(APP.currentUser);document.getElementById('profileModal').classList.add('show')}}
function closeProfileModal(){document.getElementById('profileModal').classList.remove('show');closeProfileEdit()}
function toggleProfileEdit(){const p=document.getElementById('profileEditPanel');p.style.display=p.style.display==='none'?'block':'none';const m=APP.currentUser;if(m){document.getElementById('editProfileName').value=m.name;document.getElementById('editProfileRole').value=m.role;document.getElementById('editProfilePhone').value=m.phone;document.getElementById('editProfileEmail').value=m.email}}
function closeProfileEdit(){document.getElementById('profileEditPanel').style.display='none'}
async function saveProfileChanges(){const m=APP.currentUser;if(!m)return;try{const res=await api('updateOwnProfile',{employeeId:m.employeeId,role:m.role,phone:document.getElementById('editProfilePhone').value.trim(),email:document.getElementById('editProfileEmail').value.trim(),photo:m.photo||''});APP.currentUser=res.member;APP.members=APP.members.map(x=>x.employeeId===m.employeeId?res.member:x);updateProfileUI();closeProfileEdit();toast('Profile updated')}catch(e){toast(e.message||e)}}
async function uploadProfilePhoto(e){const f=e.target.files[0];if(!f||!APP.currentUser)return;try{const url=await uploadFile(f,'uploadPhoto',APP.currentUser.name);const res=await api('updateOwnProfile',{employeeId:APP.currentUser.employeeId,phone:APP.currentUser.phone,email:APP.currentUser.email,photo:url});APP.currentUser=res.member;APP.members=APP.members.map(x=>x.employeeId===APP.currentUser.employeeId?res.member:x);updateProfileUI();fillProfile(APP.currentUser);toast('Profile photo updated successfully')}catch(err){toast(err.message||err)}e.target.value=''}
function execCmd(cmd){document.execCommand(cmd,false,null);document.getElementById('fullDescription').focus()}
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&(document.activeElement===document.getElementById('loginEmployeeId')||document.activeElement===document.getElementById('loginPassword')))login();if(e.key==='Escape'){closeTaskDetails();closeAnnouncementModal();closeAnnouncementDetails()}});
window.addEventListener('load',init);

document.addEventListener('click',function(e){const wrap=document.getElementById('multiAssignee');if(wrap&&!wrap.contains(e.target))closeAssigneePicker();});
/* =========================================================
   TASK COMMAND — PREMIUM REPORT EXPORT V4
   PDF + Excel use the same visual structure as the supplied
   reference image. CSV is intentionally disabled.
   ========================================================= */
(function(){
'use strict';

function _rEsc(v){
  return String(v==null?'':v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function _rNorm(v){return String(v==null?'':v).trim().toLowerCase();}
function _rStatus(v){
  const s=_rNorm(v).replace(/_/g,'-');
  if(s==='in-progress'||s==='in progress'||s==='inprogress')return 'In Progress';
  if(s==='completed'||s==='complete'||s==='done')return 'Completed';
  if(s==='cancelled'||s==='canceled')return 'Cancelled';
  return 'Pending';
}
function _rAssigned(t){
  try{if(typeof taskAssignedToText==='function')return taskAssignedToText(t)||'';}catch(e){}
  return t.assignedTo||t.assigned_to||'';
}
function _rFilter(){
  let tasks=Array.isArray(APP.tasks)?APP.tasks.slice():[];
  const empEl=document.getElementById('reportEmployee');
  const periodEl=document.getElementById('reportPeriod');
  const startEl=document.getElementById('reportStartDate')||document.getElementById('reportStart');
  const endEl=document.getElementById('reportEndDate')||document.getElementById('reportEnd');
  const employee=isOwner()?String(empEl?.value||'ALL'):(APP.currentUser?.name||'');
  const period=_rNorm(periodEl?.value||'all');
  const startVal=startEl?.value||'';
  const endVal=endEl?.value||'';
  if(employee && employee!=='ALL'){
    const want=_rNorm(employee);
    tasks=tasks.filter(t=>_rAssigned(t).split(',').some(n=>_rNorm(n)===want)||_rNorm(t.assignedTo)===want||_rNorm(t.assigned_to)===want);
  }else if(!isOwner()){
    const want=_rNorm(APP.currentUser?.name||'');
    tasks=tasks.filter(t=>_rAssigned(t).split(',').some(n=>_rNorm(n)===want)||_rNorm(t.assignedTo)===want||_rNorm(t.assigned_to)===want);
  }
  let from=null,to=null,now=new Date();
  if(period==='daily'||period==='day'){from=new Date(now.getFullYear(),now.getMonth(),now.getDate());to=new Date(from);to.setDate(to.getDate()+1);}
  else if(period==='weekly'||period==='week'){from=new Date(now);from.setHours(0,0,0,0);const d=from.getDay();from.setDate(from.getDate()-(d===0?6:d-1));to=new Date(from);to.setDate(to.getDate()+7);}
  else if(period==='monthly'||period==='month'){from=new Date(now.getFullYear(),now.getMonth(),1);to=new Date(now.getFullYear(),now.getMonth()+1,1);}
  else if(period==='custom'){if(startVal)from=new Date(startVal+'T00:00:00');if(endVal)to=new Date(endVal+'T23:59:59');}
  if(from||to)tasks=tasks.filter(t=>{const d=new Date(t.createdAt||t.created_at||t.deadline||0);if(isNaN(d.getTime()))return false;return (!from||d>=from)&&(!to||d<=to);});
  return {tasks,employee:employee||'ALL',period,startVal,endVal};
}
function _rRows(f){
  return f.tasks.map(t=>[
    t.id||t.task_id||'',
    t.taskType||t.task_type||'',
    t.department||t.taskDepartment||'Other',
    _rAssigned(t),
    t.createdByName||t.assignedBy||t.assigned_by_name||'Owner',
    t.priority||'Medium',
    t.deadline||'',
    _rStatus(t.status)
  ]);
}
function _rDownload(bytes,name,type){
  const blob=new Blob([bytes],{type:type||'application/octet-stream'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=name;a.style.display='none';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function _rDate(){return new Date().toLocaleString(undefined,{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});}

/* ---------- Excel exporter: reference table format ---------- */
function _xlsxEsc(v){
  return String(v==null?'':v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&apos;');
}
function _u16(n){return [n&255,(n>>>8)&255];}
function _u32(n){return [n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];}
function _bytes(s){return Array.from(new TextEncoder().encode(String(s)));}
function _crc32(bytes){
  if(!_crc32.t){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}_crc32.t=t;}
  let c=0xffffffff;for(let i=0;i<bytes.length;i++)c=_crc32.t[(c^bytes[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;
}
function _zipStore(files){
  const out=[],central=[];let offset=0;
  const push=(a,b)=>{for(const x of b)a.push(x);};
  for(const f of files){
    const name=_bytes(f.name),data=_bytes(f.data),crc=_crc32(data),local=[];
    push(local,[0x50,0x4b,0x03,0x04]);push(local,_u16(20));push(local,_u16(0));push(local,_u16(0));push(local,_u16(0));push(local,_u16(0));
    push(local,_u32(crc));push(local,_u32(data.length));push(local,_u32(data.length));push(local,_u16(name.length));push(local,_u16(0));push(local,name);push(local,data);push(out,local);
    const ch=[];push(ch,[0x50,0x4b,0x01,0x02]);push(ch,_u16(20));push(ch,_u16(20));push(ch,_u16(0));push(ch,_u16(0));push(ch,_u16(0));push(ch,_u16(0));
    push(ch,_u32(crc));push(ch,_u32(data.length));push(ch,_u32(data.length));push(ch,_u16(name.length));push(ch,_u16(0));push(ch,_u16(0));push(ch,_u16(0));push(ch,_u16(0));push(ch,_u32(0));push(ch,_u32(offset));push(ch,name);central.push(ch);offset+=local.length;
  }
  const cdStart=offset;let cdSize=0;for(const c of central){push(out,c);cdSize+=c.length;}
  const end=[];push(end,[0x50,0x4b,0x05,0x06]);push(end,_u16(0));push(end,_u16(0));push(end,_u16(files.length));push(end,_u16(files.length));push(end,_u32(cdSize));push(end,_u32(cdStart));push(end,_u16(0));push(out,end);
  return new Uint8Array(out);
}
function _col(n){let s='';n--;do{s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1;}while(n>=0);return s;}
function _xlsxCell(ref,val,style=0){
  const s=_xlsxEsc(val);
  if(typeof val==='number' && isFinite(val))return '<c r="'+ref+'" s="'+style+'" t="n"><v>'+val+'</v></c>';
  return '<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+s+'</t></is></c>';
}
const _XLSX_TABLE_STYLES='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
'<numFmts count="0"/>'+ 
'<fonts count="5">'+
'<font><name val="Calibri"/><sz val="11"/><color rgb="FF0F172A"/></font>'+
'<font><name val="Calibri"/><b/><sz val="11"/><color rgb="FFFFFFFF"/></font>'+
'<font><name val="Calibri"/><b/><sz val="11"/><color rgb="FF0F172A"/></font>'+
'<font><name val="Calibri"/><b/><sz val="10"/><color rgb="FF0F172A"/></font>'+
'<font><name val="Calibri"/><sz val="10"/><color rgb="FF0F172A"/></font>'+
'</fonts>'+
'<fills count="7">'+
'<fill><patternFill patternType="none"/></fill>'+
'<fill><patternFill patternType="gray125"/></fill>'+
'<fill><patternFill patternType="solid"><fgColor rgb="FF173B8F"/><bgColor indexed="64"/></patternFill></fill>'+
'<fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>'+
'<fill><patternFill patternType="solid"><fgColor rgb="FFE8F1FF"/><bgColor indexed="64"/></patternFill></fill>'+
'<fill><patternFill patternType="solid"><fgColor rgb="FFFFE7A6"/><bgColor indexed="64"/></patternFill></fill>'+
'<fill><patternFill patternType="solid"><fgColor rgb="FFD9C8FF"/><bgColor indexed="64"/></patternFill></fill>'+
'</fills>'+
'<borders count="2">'+
'<border><left/><right/><top/><bottom/><diagonal/></border>'+
'<border><left style="thin"><color rgb="FFD5DEEE"/></left><right style="thin"><color rgb="FFD5DEEE"/></right><top style="thin"><color rgb="FFD5DEEE"/></top><bottom style="thin"><color rgb="FFD5DEEE"/></bottom><diagonal/></border>'+
'</borders>'+
'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
'<cellXfs count="7">'+
'<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'+
'<xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'+
'<xf numFmtId="0" fontId="2" fillId="4" borderId="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>'+
'<xf numFmtId="0" fontId="3" fillId="3" borderId="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>'+
'<xf numFmtId="0" fontId="3" fillId="5" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'+
'<xf numFmtId="0" fontId="3" fillId="6" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'+
'<xf numFmtId="0" fontId="4" fillId="3" borderId="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>'+
'</cellXfs>'+
'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'+
'<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>'+
'</styleSheet>';
const _XLSX_THEME='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';
const _XLSX_CT='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
function _makeXlsx(rows,f){
  const headers=['Task ID','Task Type','Department','Assigned To','Assigned By','Follow-up','Priority','Deadline','Status','Created At','Completed At'];
  const out=[];
  const safe=(v)=>v==null?'':String(v);
  const created=t=>safe(t.createdAt||t.created_at||'');
  const completed=t=>safe(t.completedAt||t.completed_at||'');
  const taskRows=(Array.isArray(f.tasks)?f.tasks:[]).map(t=>[
    safe(t.id||t.task_id||''),safe(t.taskType||t.task_type||''),safe(t.department||t.taskDepartment||'Other'),
    safe(_rAssigned(t)),safe(t.createdByName||t.assignedBy||t.assigned_by_name||'Owner'),
    safe(t.followUp||t.follow_up||t.followup||''),safe(t.priority||'Medium'),safe(t.deadline||''),_rStatus(t.status),created(t),completed(t)
  ]);
  // Header row — intentionally matches the supplied Excel reference.
  let xml='';
  xml+='<row r="1" ht="24" customHeight="1">';headers.forEach((h,i)=>xml+=_xlsxCell(_col(i+1)+1,h,1));xml+='</row>';
  taskRows.forEach((r,i)=>{
    const n=i+2, rowFill=(i%2===0)?2:3;
    xml+='<row r="'+n+'" ht="30" customHeight="1">';
    r.forEach((v,j)=>{
      let st=rowFill;
      if(j===6)st=_rNorm(v)==='high'?4:3;
      if(j===8){const s=_rStatus(v);st=s==='In Progress'?5:(s==='Completed'?3:4);}
      xml+=_xlsxCell(_col(j+1)+n,v,st);
    });
    xml+='</row>';
  });
  const last=Math.max(1,taskRows.length+1);
  const widths=[22,34,18,28,28,22,13,15,17,24,24];
  const cols=widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('');
  const sheet='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
    '<sheetPr><outlinePr summaryBelow="1" summaryRight="1"/><pageSetUpPr fitToPage="1"/></sheetPr>'+
    '<dimension ref="A1:K'+last+'"/>'+
    '<sheetViews><sheetView showGridLines="1" workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>'+
    '<sheetFormatPr defaultRowHeight="18"/>'+
    '<cols>'+cols+'</cols>'+
    '<sheetData>'+xml+'</sheetData>'+
    '<autoFilter ref="A1:K'+last+'"/>'+
    '<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>'+
    '<pageSetup orientation="landscape" paperSize="9" fitToHeight="0" fitToWidth="1"/>'+
    '</worksheet>';
  const wb='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="Task Report" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const rels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml" Id="rId1"/><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml" Id="rId2"/><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml" Id="rId3"/></Relationships>';
  const root='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml" Id="rId1"/><Relationship Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml" Id="rId2"/><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml" Id="rId3"/></Relationships>';
  const core='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Task Command</dc:creator><dc:title>Task Performance Report</dc:title></cp:coreProperties>';
  const app='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Task Command</Application></Properties>';
  return _zipStore([
    {name:'[Content_Types].xml',data:_XLSX_CT},{name:'_rels/.rels',data:root},{name:'xl/workbook.xml',data:wb},
    {name:'xl/_rels/workbook.xml.rels',data:rels},{name:'xl/worksheets/sheet1.xml',data:sheet},
    {name:'xl/styles.xml',data:_XLSX_TABLE_STYLES},{name:'xl/theme/theme1.xml',data:_XLSX_THEME},
    {name:'docProps/core.xml',data:core},{name:'docProps/app.xml',data:app}
  ]);
}
/* ---------- Reference-matched PDF ---------- */
function _pdfEsc(s){return String(s==null?'':s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');}
function _pdfText(c,font,size,x,y,text,color){
  c.push((color||'0.06 0.10 0.16')+' rg BT /'+font+' '+size+' Tf '+x.toFixed(2)+' '+y.toFixed(2)+' Td ('+_pdfEsc(text)+') Tj ET');
}
function _pdfCenter(c,font,size,x,y,text,color){
  const approx=String(text).length*size*0.48;_pdfText(c,font,size,x-approx/2,y,text,color);
}
function _pdfRect(c,x,y,w,h,color){c.push(color+' rg '+x+' '+y+' '+w+' '+h+' re f');}
function _pdfWrap(s,max){const words=String(s??'').split(/\s+/),out=[];let cur='';for(const w of words){if((cur+' '+w).trim().length>max&&cur){out.push(cur);cur=w;}else cur=(cur+' '+w).trim();}if(cur)out.push(cur);return out.length?out:[''];}
function _makePdf(rows,f){
  const W=841.89,H=595.28,objects=[];
  const add=o=>{objects.push(o);return objects.length;};
  const font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const bold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pages=[];const perPage=6;const pageCount=Math.max(1,Math.ceil(rows.length/perPage));
  const total=rows.length,complete=rows.filter(r=>r[7]==='Completed').length,pending=rows.filter(r=>r[7]==='Pending').length,progress=rows.filter(r=>r[7]==='In Progress').length;
  for(let pg=0;pg<pageCount;pg++){
    const c=[];c.push('q 1 0 0 1 0 0 cm');_pdfRect(c,0,0,W,H,'1 1 1');
    _pdfCenter(c,'F2',27,W/2,548,'TASK COMMAND','0.09 0.23 0.56');
    _pdfCenter(c,'F2',15,W/2,523,'TASK PERFORMANCE REPORT','0.39 0.23 1.00');
    _pdfCenter(c,'F2',9,W/2,504,'Employee: '+(f.employee||'ALL')+'    |    Period: '+String(f.period||'all').toUpperCase()+'    |    Generated: '+_rDate(),'0.36 0.42 0.52');
    const x0=18,gap=2,cw=(W-36-gap*3)/4,headerY=438,bodyY=402;
    const cards=[['TOTAL TASKS',total,'0.91 0.95 1.00','0.09 0.23 0.56'],['COMPLETED',complete,'0.91 0.98 0.94','0.20 0.56 0.35'],['PENDING',pending,'1.00 0.97 0.89','0.90 0.54 0.00'],['IN PROGRESS',progress,'0.94 0.91 1.00','0.42 0.21 0.79']];
    cards.forEach((k,i)=>{const x=x0+i*(cw+gap);_pdfRect(c,x,headerY,cw,24,'0.09 0.23 0.56');_pdfCenter(c,'F2',9,x+cw/2,446,k[0],'1 1 1');_pdfRect(c,x,bodyY,cw,36,k[2]);_pdfCenter(c,'F2',22,x+cw/2,413,String(k[1]),k[3]);});
    const tableX=18,tableW=W-36,th=25,rowH=42,top=355;const widths=[87,123,92,96,96,78,80,101];let xx=tableX;
    _pdfRect(c,tableX,top,tableW,th,'0.09 0.23 0.56');
    const headers=['TASK ID','TASK TYPE','DEPARTMENT','ASSIGNED TO','ASSIGNED BY','PRIORITY','DEADLINE','STATUS'];
    headers.forEach((h,i)=>{_pdfText(c,'F2',7.5,xx+5,top+9,h,'1 1 1');xx+=widths[i];});
    const slice=rows.slice(pg*perPage,(pg+1)*perPage);let y=top-rowH;
    slice.forEach((r,ri)=>{
      _pdfRect(c,tableX,y,tableW,rowH,ri%2===0?'0.985 0.992 1.00':'0.96 0.975 0.995');
      let x=tableX;
      for(let i=0;i<8;i++){
        const max=i===1?21:(i===0?16:17);if(i!==5&&i!==7){const lines=_pdfWrap(r[i],max).slice(0,2);lines.forEach((line,li)=>_pdfText(c,'F2',7.1,x+5,y+25-li*10,line,'0.05 0.09 0.15'));}
        if(i===5||i===7){
          let fill=null;
          if(i===5)fill=_rNorm(r[i])==='high'?'0.98 0.78 0.78':'1.00 0.90 0.55';
          if(i===7)fill=r[i]==='Completed'?'0.72 0.90 0.78':r[i]==='In Progress'?'0.82 0.73 1.00':'1.00 0.82 0.48';
          if(fill){const label=String(r[i]),bw=Math.min(widths[i]-12,Math.max(42,label.length*4.3+12));_pdfRect(c,x+4,y+7,bw,18,fill);_pdfText(c,'F2',7,x+10,y+13,label,'0.05 0.09 0.15');}
        }
        x+=widths[i];
      }
      c.push('0.84 0.88 0.94 RG 0.5 w '+tableX+' '+y+' m '+(tableX+tableW)+' '+y+' l S');y-=rowH;
    });
    _pdfCenter(c,'F2',8,W/2,34,'TASK COMMAND   |   Centralized Team Management   |   '+total+' task(s) in this report','0.36 0.42 0.52');
    _pdfText(c,'F1',7,W-52,20,(pg+1)+' / '+pageCount,'0.36 0.42 0.52');c.push('Q');
    const stream=c.join('\n');const streamObj=add('<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream');
    const page=add('<< /Type /Page /Parent 0 0 R /MediaBox [0 0 '+W+' '+H+'] /Resources << /Font << /F1 '+font+' 0 R /F2 '+bold+' 0 R >> >> /Contents '+streamObj+' 0 R >>');pages.push(page);
  }
  const pagesObj=add('<< /Type /Pages /Kids ['+pages.map(n=>n+' 0 R').join(' ')+'] /Count '+pages.length+' >>');
  pages.forEach(n=>{objects[n-1]=objects[n-1].replace('/Parent 0 0 R','/Parent '+pagesObj+' 0 R');});
  const catalog=add('<< /Type /Catalog /Pages '+pagesObj+' 0 R >>');
  let pdf='%PDF-1.4\n%âãÏÓ\n',offs=[0];for(let i=0;i<objects.length;i++){offs[i+1]=pdf.length;pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}
  const xref=pdf.length;pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';for(let i=1;i<offs.length;i++)pdf+=String(offs[i]).padStart(10,'0')+' 00000 n \n';pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root '+catalog+' 0 R >>\nstartxref\n'+xref+'\n%%EOF';
  return new TextEncoder().encode(pdf);
}

let _reportBusy=false;
async function _premiumReportDownload(kind){
  if(_reportBusy)return;
  if(!APP?.currentUser){try{toast('Please login first.')}catch(e){}return;}
  _reportBusy=true;
  try{
    const f=_rFilter(),rows=_rRows(f);window.__TC_REPORT_META={employee:f.employee,period:f.period};
    const stamp=new Date().toISOString().replace(/[:.]/g,'-'),safe=String(f.employee||'ALL').replace(/[^a-z0-9]+/gi,'_');
    const base='TASK_COMMAND_'+safe+'_'+String(f.period||'all').toUpperCase()+'_'+stamp;
    if(kind==='pdf'){_rDownload(_makePdf(rows,f),base+'.pdf','application/pdf');try{toast('PDF report downloaded — '+rows.length+' task(s)')}catch(e){}}
    else if(kind==='excel'||kind==='xlsx'){_rDownload(_makeXlsx(rows,f),base+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');try{toast('Excel report downloaded — '+rows.length+' task(s)')}catch(e){}}
  }catch(e){console.error('PREMIUM REPORT EXPORT',e);try{toast('Report download failed: '+(e.message||e))}catch(x){alert('Report download failed: '+(e.message||e))}}
  finally{setTimeout(()=>{_reportBusy=false;},700);}
}
window.downloadTaskReport=_premiumReportDownload;

function _bindPremiumReportButtons(){
  document.querySelectorAll('button,a,.report-btn').forEach(btn=>{
    const text=(btn.textContent||'').trim().toLowerCase(),oc=(btn.getAttribute('onclick')||'').toLowerCase();
    if(text.includes('csv')||oc.includes('csv')){btn.style.display='none';return;}
    const isExcel=text.includes('excel')||text.includes('xlsx')||oc.includes('xlsx')||oc.includes('excel');
    const isPdf=text.includes('pdf')||oc.includes('pdf');
    if(!isExcel&&!isPdf)return;
    btn.removeAttribute('onclick');btn.onclick=null;
    if(btn.dataset.tcPremiumBound==='1')return;
    btn.dataset.tcPremiumBound='1';
    btn.addEventListener('click',function(e){e.preventDefault();e.stopImmediatePropagation();_premiumReportDownload(isExcel?'excel':'pdf');},true);
  });
}
window.addEventListener('load',()=>setTimeout(_bindPremiumReportButtons,250));
setTimeout(_bindPremiumReportButtons,800);
setTimeout(_bindPremiumReportButtons,1800);
})();
/* TASK COMMAND — TEAM CHAT ADD-ON
   Adds ONLY the Team Chat page + sidebar entry. Existing pages/functions are untouched.
   Uses the existing Supabase Chat RPCs from the project's chat schema.
*/
(function(){
  'use strict';
  const C={conversations:[],messages:[],people:[],activeId:null,active:null,poll:null,lastPoll:new Date(Date.now()-10000).toISOString(),busy:false};
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const initials2=n=>String(n||'U').trim().split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()||'U';
  const me=()=>APP?.currentUser?.employeeId||APP?.currentUser?.id||'';
  const token=()=>APP?.sessionToken||localStorage.getItem('taskCommandSession')||'';
  async function rpc(name,params){
    if(!window.supabaseClient?.rpc) throw new Error('Supabase client is not initialized.');
    const {data,error}=await supabaseClient.rpc(name,params); if(error) throw error; return data||{};
  }
  function time(v){if(!v)return '';const d=new Date(v);return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}
  function day(v){if(!v)return '';const d=new Date(v),n=new Date();if(d.toDateString()===n.toDateString())return 'Today';return d.toLocaleDateString([], {day:'2-digit',month:'short'});}
  function notify(title,body){
    try{ if(document.hidden && 'Notification' in window && Notification.permission==='granted') new Notification(title,{body}); }catch(e){}
  }
  function css(){
    if($('tcChatStyle'))return;
    const s=document.createElement('style');s.id='tcChatStyle';s.textContent=`
      #tc-chat-page{padding:0!important;background:var(--bg-main,#f4f7fb)!important;min-height:calc(100vh - 80px);overflow:hidden}
      .tc-chat-wrap{height:calc(100vh - 125px);min-height:650px;display:grid;grid-template-columns:310px minmax(420px,1fr) 285px;background:#fff;border:1px solid rgba(25,83,150,.14);border-radius:18px;overflow:hidden;box-shadow:0 12px 35px rgba(16,58,105,.08)}
      .tc-chat-left{border-right:1px solid #e5edf6;background:#fbfdff;display:flex;flex-direction:column;min-width:0}.tc-chat-left-head{padding:18px 16px 12px;border-bottom:1px solid #e8eef6}.tc-chat-title{font-size:20px;font-weight:850;color:#102b50;margin:0}.tc-chat-sub{font-size:11px;color:#71839b;margin-top:3px}.tc-chat-search{margin-top:13px;display:flex;gap:8px}.tc-chat-search input{width:100%;padding:11px 12px;border:1px solid #d9e4f0;border-radius:11px;background:#fff;outline:none}.tc-chat-new{border:0;border-radius:11px;background:#146bd3;color:#fff;font-weight:800;padding:0 12px;cursor:pointer}.tc-chat-list{overflow:auto;padding:8px}.tc-conv{display:flex;gap:10px;padding:11px;border-radius:13px;cursor:pointer;align-items:center}.tc-conv:hover{background:#f0f6fd}.tc-conv.active{background:#e6f1ff}.tc-avatar{width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,#0a55b5,#398dff);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:850;overflow:hidden;flex:none}.tc-avatar img{width:100%;height:100%;object-fit:cover}.tc-conv-main{min-width:0;flex:1}.tc-conv-name{font-size:13px;font-weight:800;color:#132c4e}.tc-conv-last{font-size:11px;color:#74859b;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tc-conv-side{text-align:right;align-self:flex-start}.tc-conv-time{font-size:9px;color:#8a98a9}.tc-unread{display:inline-grid;place-items:center;min-width:19px;height:19px;border-radius:10px;background:#1670dc;color:#fff;font-size:9px;font-weight:850;margin-top:5px}
      .tc-chat-center{display:flex;flex-direction:column;min-width:0;background:#f4f8fd}.tc-chat-head{height:76px;display:flex;align-items:center;gap:11px;padding:0 17px;background:#fff;border-bottom:1px solid #e4ebf4}.tc-chat-head-info{min-width:0;flex:1}.tc-chat-head-name{font-weight:850;font-size:15px;color:#132b4d}.tc-chat-head-status{font-size:10px;color:#66809d;margin-top:3px}.tc-chat-actions{display:flex;gap:7px}.tc-chat-icon{width:35px;height:35px;border:1px solid #dce6f1;border-radius:10px;background:#fff;color:#1d5e9f;cursor:pointer}.tc-chat-icon:hover{background:#edf5ff}.tc-messages{flex:1;overflow:auto;padding:18px 20px;background:linear-gradient(rgba(255,255,255,.74),rgba(255,255,255,.74)),radial-gradient(circle at 20% 20%,#dbeeff,transparent 35%);}.tc-date{text-align:center;font-size:9px;color:#8190a4;margin:4px 0 15px}.tc-msg-row{display:flex;margin:8px 0}.tc-msg-row.mine{justify-content:flex-end}.tc-bubble{max-width:min(72%,560px);padding:10px 12px;border-radius:15px;background:#fff;border:1px solid #e0e8f2;box-shadow:0 3px 10px rgba(20,58,98,.045);position:relative}.tc-msg-row.mine .tc-bubble{background:#1670dc;color:#fff;border-color:#1670dc;border-bottom-right-radius:5px}.tc-msg-row:not(.mine) .tc-bubble{border-bottom-left-radius:5px}.tc-msg-sender{font-size:9px;font-weight:850;color:#1467c8;margin-bottom:4px}.tc-msg-row.mine .tc-msg-sender{color:#d8eaff}.tc-msg-body{font-size:13px;line-height:1.48;white-space:pre-wrap;word-break:break-word}.tc-msg-meta{text-align:right;font-size:8px;opacity:.65;margin-top:5px}.tc-file{display:flex;gap:9px;align-items:center;margin-top:7px;padding:9px;border-radius:10px;background:rgba(255,255,255,.72);color:#164e86;text-decoration:none}.tc-msg-row.mine .tc-file{color:#0c3f79}.tc-compose{padding:11px 14px;background:#fff;border-top:1px solid #e2eaf3;display:flex;gap:7px;align-items:center}.tc-compose input{flex:1;padding:12px;border:1px solid #d7e3ef;border-radius:13px;background:#f8fbff;outline:none}.tc-send{width:43px;height:43px;border:0;border-radius:13px;background:linear-gradient(135deg,#0967d4,#3c87ff);color:#fff;font-size:16px;cursor:pointer}.tc-empty{height:100%;display:grid;place-items:center;color:#7890aa;text-align:center;padding:30px}.tc-empty b{display:block;color:#23486f;font-size:18px;margin-bottom:5px}
      .tc-chat-right{background:#fff;border-left:1px solid #e4ebf4;overflow:auto}.tc-profile{padding:24px 18px;text-align:center;border-bottom:1px solid #e6edf5}.tc-profile-avatar{width:78px;height:78px;border-radius:22px;margin:auto;background:linear-gradient(135deg,#0a55b5,#3c8eff);color:#fff;display:grid;place-items:center;font-size:23px;font-weight:850;overflow:hidden}.tc-profile-avatar img{width:100%;height:100%;object-fit:cover}.tc-profile-name{font-weight:850;font-size:17px;margin-top:10px}.tc-profile-sub{font-size:10px;color:#73869e;margin-top:3px}.tc-info{padding:16px 18px;border-bottom:1px solid #edf1f6}.tc-label{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#8797ab;font-weight:850}.tc-value{font-size:12px;color:#213d61;margin-top:6px;word-break:break-word}.tc-person{display:flex;gap:8px;align-items:center;margin-top:10px;font-size:11px}.tc-person .tc-avatar{width:30px;height:30px;border-radius:9px;font-size:9px}.tc-dark .tc-chat-wrap{background:#0d1726;color:#e8f1fb}.tc-dark .tc-chat-left,.tc-dark .tc-chat-right,.tc-dark .tc-chat-head,.tc-dark .tc-compose{background:#111e30;border-color:#263b55}.tc-dark .tc-chat-center{background:#0b1523}.tc-dark .tc-chat-title,.tc-dark .tc-conv-name,.tc-dark .tc-chat-head-name,.tc-dark .tc-profile-name,.tc-dark .tc-value{color:#e8f1fb}.tc-dark .tc-chat-sub,.tc-dark .tc-conv-last,.tc-dark .tc-chat-head-status,.tc-dark .tc-profile-sub{color:#91a8c3}.tc-dark .tc-chat-search input,.tc-dark .tc-compose input,.tc-dark .tc-chat-icon{background:#0d1929;color:#e7eff9;border-color:#30445e}.tc-dark .tc-conv:hover{background:#17283d}.tc-dark .tc-conv.active{background:#19375b}.tc-dark .tc-messages{background:linear-gradient(rgba(10,20,33,.72),rgba(10,20,33,.72)),radial-gradient(circle at 20% 20%,#173b63,transparent 35%)}.tc-dark .tc-bubble{background:#17283a;color:#eaf2fb;border-color:#29425d}.tc-dark .tc-msg-row.mine .tc-bubble{background:#0b64cb;border-color:#0b64cb}.tc-dark .tc-empty b{color:#dceafa}
      .tc-chat-modal{position:fixed;inset:0;z-index:100010;background:rgba(3,12,30,.64);backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;padding:18px}.tc-chat-modal.show{display:flex}.tc-chat-modal-card{width:min(620px,96vw);max-height:88vh;overflow:auto;background:#fff;border-radius:20px;padding:20px;box-shadow:0 30px 90px rgba(0,0,0,.35)}.tc-chat-modal-card h3{margin:0 0 5px}.tc-chat-modal-card p{font-size:11px;color:#71839a;margin:0 0 15px}.tc-person-search{width:100%;padding:11px;border:1px solid #d9e4f0;border-radius:10px;margin-bottom:10px}.tc-people{max-height:350px;overflow:auto}.tc-person-option{display:flex;align-items:center;gap:10px;padding:10px;border-radius:11px;cursor:pointer}.tc-person-option:hover{background:#f2f7fd}.tc-check{margin-left:auto}.tc-modal-actions{display:flex;gap:8px;margin-top:15px}.tc-modal-actions button{flex:1;padding:11px;border:0;border-radius:11px;font-weight:800;cursor:pointer}.tc-cancel{background:#edf2f7;color:#243d5e}.tc-primary{background:#176dd6;color:#fff}.tc-group-name{width:100%;padding:11px;border:1px solid #d9e4f0;border-radius:10px;margin:8px 0 12px}.tc-page-toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.tc-page-toolbar h2{margin:0}.tc-toolbar-actions{display:flex;gap:7px}.tc-toolbar-actions button{border:1px solid #dbe5f0;background:#fff;border-radius:10px;padding:9px 11px;cursor:pointer;color:#1b5f9f}.tc-toolbar-actions .primary{background:#126bd5;color:#fff;border-color:#126bd5}.tc-chat-attach{display:none}
      @media(max-width:1050px){.tc-chat-wrap{grid-template-columns:280px 1fr}.tc-chat-right{display:none}}@media(max-width:720px){.tc-chat-wrap{grid-template-columns:1fr;height:calc(100vh - 115px)}.tc-chat-left{display:none}.tc-chat-page{padding:0!important}.tc-bubble{max-width:84%}}
    `;document.head.appendChild(s);
  }
  function page(){
    if($('tc-chat-page'))return;
    const host=document.querySelector('.content-area')||document.body;
    const p=document.createElement('div');p.id='tc-chat-page';p.className='modal-page';
    p.innerHTML=`<div class="tc-page-toolbar"><div><h2><i class="fas fa-comments" style="color:#126bd5"></i> Team Chat</h2><div style="font-size:11px;color:var(--text-muted,#71839a)">Connect and collaborate with your team</div></div><div class="tc-toolbar-actions"><button class="primary" onclick="tcOpenNewChat()"><i class="fas fa-plus"></i> New Chat</button><button onclick="tcToggleDark()" title="Chat theme">◐</button></div></div>
    <div class="tc-chat-wrap"><aside class="tc-chat-left"><div class="tc-chat-left-head"><div class="tc-chat-title">Messages</div><div class="tc-chat-sub">Your conversations</div><div class="tc-chat-search"><input id="tcSearch" placeholder="Search conversations..." oninput="tcFilterChats(this.value)"><button class="tc-chat-new" onclick="tcOpenNewChat()">＋</button></div></div><div id="tcChatList" class="tc-chat-list"></div></aside>
    <main class="tc-chat-center"><div id="tcChatHead" class="tc-chat-head"><div class="tc-empty"><div><b>Select a conversation</b><span>Choose a chat from the left</span></div></div></div><div id="tcMessages" class="tc-messages"><div class="tc-empty"><div><b>Team Chat</b><span>Start a conversation with a team member.</span></div></div></div><div class="tc-compose"><button class="tc-chat-icon" onclick="document.getElementById('tcChatFile').click()">📎</button><input id="tcChatFile" class="tc-chat-attach" type="file" onchange="tcSendFile(this.files[0])"><input id="tcComposeInput" placeholder="Type a message..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();tcSendMessage()}"><button class="tc-send" onclick="tcSendMessage()">➤</button></div></main>
    <aside id="tcChatRight" class="tc-chat-right"><div class="tc-empty"><div><b>Chat details</b><span>Select a conversation to view details.</span></div></div></aside></div>`;
    host.appendChild(p);
    const modal=document.createElement('div');modal.id='tcChatModal';modal.className='tc-chat-modal';modal.onclick=e=>{if(e.target===modal)tcCloseNewChat()};document.body.appendChild(modal);
  }
  function sidebar(){
    if($('tcChatNav'))return;
    const side=$('sidebar');if(!side)return;
    const candidates=[...side.querySelectorAll('.nav-item')];
    const el=document.createElement('a');el.id='tcChatNav';el.href='javascript:void(0)';el.className='nav-item';el.innerHTML='<i class="fas fa-comments"></i><span>Team Chat</span><span id="tcChatBadge" style="display:none;margin-left:auto;background:#ef4444;color:#fff;border-radius:12px;padding:2px 7px;font-size:10px;font-weight:800"></span>';
    el.onclick=function(){switchPage('tc-chat-page','Team Chat',el);tcOpenPage()};
    const ref=candidates.find(x=>/member|team|report|notification/i.test(x.textContent||''));
    (ref?.parentElement||side).appendChild(el);
  }
  function renderList(){
    const box=$('tcChatList');if(!box)return;const q=String($('tcSearch')?.value||'').toLowerCase();
    const list=C.conversations.filter(c=>!q||String(c.name||'').toLowerCase().includes(q)||String(c.lastMessage||'').toLowerCase().includes(q));
    box.innerHTML=list.length?list.map(c=>`<div class="tc-conv ${C.activeId===c.id?'active':''}" onclick="tcOpenConversation('${esc(c.id)}')"><div class="tc-avatar">${c.photo?`<img src="${esc(c.photo)}">`:initials2(c.name)}</div><div class="tc-conv-main"><div class="tc-conv-name">${esc(c.name||'Chat')}</div><div class="tc-conv-last">${esc(c.lastMessage||'No messages yet')}</div></div><div class="tc-conv-side"><div class="tc-conv-time">${esc(day(c.lastAt))}</div>${Number(c.unread||0)>0?`<span class="tc-unread">${Math.min(99,Number(c.unread))}</span>`:''}</div></div>`).join(''):`<div class="tc-empty" style="height:260px"><div><b>No conversations</b><span>Use + to start a new chat.</span></div></div>`;
    const total=C.conversations.reduce((n,c)=>n+Number(c.unread||0),0);const b=$('tcChatBadge');if(b){b.textContent=total>99?'99+':total;b.style.display=total?'inline-block':'none'}
  }
  async function loadConversations(){
    if(!me())return;try{const d=await rpc('chat_list_conversations',{p_employee_id:String(me()),p_session_token:token()});if(d.ok===false)throw new Error(d.message||'Unable to load chats.');C.conversations=d.conversations||[];renderList();}catch(e){console.warn('CHAT LIST',e);if($('tcChatList'))$('tcChatList').innerHTML=`<div class="tc-empty"><div><b>Chat unavailable</b><span>${esc(e.message||e)}</span></div></div>`}}
  async function openConversation(id){
    C.activeId=id;C.active=C.conversations.find(x=>String(x.id)===String(id))||null;renderList();
    if(!C.active)return;
    renderHead();
    try{const d=await rpc('chat_get_messages',{p_employee_id:String(me()),p_conversation_id:id,p_session_token:token()});if(d.ok===false)throw new Error(d.message||'Unable to load messages.');C.messages=d.messages||[];renderMessages();await rpc('chat_mark_read',{p_employee_id:String(me()),p_conversation_id:id,p_session_token:token()});const c=C.conversations.find(x=>x.id===id);if(c)c.unread=0;renderList();renderRight();}catch(e){toast(e.message||String(e))}
  }
  function renderHead(){const h=$('tcChatHead');if(!h)return;const c=C.active;if(!c){h.innerHTML='';return}h.innerHTML=`<div class="tc-avatar">${c.photo?`<img src="${esc(c.photo)}">`:initials2(c.name)}</div><div class="tc-chat-head-info"><div class="tc-chat-head-name">${esc(c.name)}</div><div class="tc-chat-head-status">${c.kind==='group'?'Group conversation':'Team member chat'}</div></div><div class="tc-chat-actions"><button class="tc-chat-icon" onclick="tcRequestNotification()">🔔</button><button class="tc-chat-icon" onclick="toast('Voice/video calling requires a WebRTC signaling service.')">☎</button><button class="tc-chat-icon" onclick="tcOpenInfo()">ⓘ</button></div>`}
  function renderMessages(){const box=$('tcMessages');if(!box)return;const arr=C.messages||[];box.innerHTML=arr.length?`<div class="tc-date">${esc(day(arr[0]?.createdAt||new Date()))}</div>`+arr.map(m=>{const mine=String(m.senderId)===String(APP.currentUser?.id||APP.currentUser?.employeeId);return `<div class="tc-msg-row ${mine?'mine':''}"><div class="tc-bubble"><div class="tc-msg-sender">${mine?'You':esc(m.senderName||'Team Member')}</div><div class="tc-msg-body">${esc(m.body||'')}</div>${m.attachmentUrl?`<a class="tc-file" href="${esc(m.attachmentUrl)}" target="_blank" rel="noopener">📎 ${esc(m.attachmentName||'Attachment')}</a>`:''}<div class="tc-msg-meta">${time(m.createdAt)} ${mine?'✓✓':''}</div></div></div>`}).join(''):`<div class="tc-empty"><div><b>No messages yet</b><span>Send the first message.</span></div></div>`;box.scrollTop=box.scrollHeight}
  function renderRight(){const r=$('tcChatRight');if(!r||!C.active)return;const c=C.active;const person=(APP.members||[]).find(m=>String(m.employeeId||m.id)===String(c.otherEmployeeId))||null;r.innerHTML=`<div class="tc-profile"><div class="tc-profile-avatar">${c.photo?`<img src="${esc(c.photo)}">`:initials2(c.name)}</div><div class="tc-profile-name">${esc(c.name)}</div><div class="tc-profile-sub">${c.kind==='group'?'Group Chat':'Team Member'}</div></div><div class="tc-info"><div class="tc-label">Conversation</div><div class="tc-value">${c.kind==='group'?'Group conversation':'Direct team chat'}</div></div><div class="tc-info"><div class="tc-label">Members</div><div class="tc-person"><div class="tc-avatar">${initials2(APP.currentUser?.name)}</div><span>${esc(APP.currentUser?.name||'You')}</span></div>${person?`<div class="tc-person"><div class="tc-avatar">${person.photo?`<img src="${esc(person.photo)}">`:initials2(person.name)}</div><span>${esc(person.name)}</span></div>`:''}</div>`}
  async function newChat(){
    const d=await rpc('chat_search_people',{p_employee_id:String(me()),p_query:''});if(d.ok===false)throw new Error(d.message||'Unable to load team members.');C.people=d.people||[];
    const m=$('tcChatModal');m.innerHTML=`<div class="tc-chat-modal-card"><h3>Start a New Chat</h3><p>Search active team members or create a group.</p><input class="tc-person-search" id="tcPeopleSearch" placeholder="Search people..." oninput="tcRenderPeople(this.value)"><div id="tcPeople" class="tc-people"></div><div class="tc-modal-actions"><button class="tc-cancel" onclick="tcCloseNewChat()">Cancel</button><button class="tc-primary" onclick="tcCreateSelectedChat()">Start Chat</button>${isOwner()&&APP.members?.length?'<button class="tc-primary" onclick="tcOpenGroupCreator()">Create Group</button>':''}</div></div>`;m.classList.add('show');tcRenderPeople('');
  }
  function renderPeople(q){const b=$('tcPeople');if(!b)return;const x=String(q||'').toLowerCase();const p=C.people.filter(v=>String(v.name||'').toLowerCase().includes(x)||String(v.department||'').toLowerCase().includes(x));b.innerHTML=p.map(v=>`<label class="tc-person-option"><div class="tc-avatar">${v.photo?`<img src="${esc(v.photo)}">`:initials2(v.name)}</div><div><b>${esc(v.name)}</b><div style="font-size:10px;color:#8190a4">${esc(v.department||'Team Member')}</div></div><input class="tc-check" type="radio" name="tcPerson" value="${esc(v.id)}"></label>`).join('')||'<div style="padding:15px;text-align:center;color:#7a8ba0;font-size:12px">No people found.</div>'}
  async function createSelected(){const v=document.querySelector('input[name="tcPerson"]:checked');if(!v){toast('Select a team member.');return}try{const d=await rpc('chat_open_direct',{p_employee_id:String(me()),p_other_employee_id:String(v.value),p_session_token:token()});if(d.ok===false)throw new Error(d.message||'Unable to open chat.');tcCloseNewChat();await loadConversations();await openConversation(d.conversationId)}catch(e){toast(e.message||String(e))}}
  function groupCreator(){const m=$('tcChatModal');m.innerHTML=`<div class="tc-chat-modal-card"><h3>Create Team Group</h3><p>Owner-only group creation. Select team members.</p><input id="tcGroupName" class="tc-group-name" placeholder="Group name"><div id="tcGroupPeople" class="tc-people"></div><div class="tc-modal-actions"><button class="tc-cancel" onclick="tcOpenNewChat()">Back</button><button class="tc-primary" onclick="tcCreateGroup()">Create Group</button></div></div>`;const b=$('tcGroupPeople');b.innerHTML=(APP.members||[]).filter(x=>String(x.employeeId||x.id)!==String(APP.currentUser?.employeeId||APP.currentUser?.id)).map(v=>`<label class="tc-person-option"><div class="tc-avatar">${v.photo?`<img src="${esc(v.photo)}">`:initials2(v.name)}</div><div><b>${esc(v.name)}</b><div style="font-size:10px;color:#8190a4">${esc(v.department||'Team Member')}</div></div><input class="tc-check" type="checkbox" value="${esc(v.employeeId||v.id)}"></label>`).join('')||'<div style="padding:15px;text-align:center;color:#7a8ba0;font-size:12px">No other team members.</div>'}
  async function createGroup(){const name=$('tcGroupName')?.value.trim();const ids=[...document.querySelectorAll('#tcGroupPeople input:checked')].map(x=>x.value);if(!name){toast('Enter a group name.');return}try{const d=await rpc('chat_create_group',{p_employee_id:String(me()),p_name:name,p_member_ids:ids,p_session_token:token()});if(d.ok===false)throw new Error(d.message||'Unable to create group.');tcCloseNewChat();await loadConversations();await openConversation(d.conversationId)}catch(e){toast(e.message||String(e))}}
  async function send(){if(!C.activeId||C.busy)return;const input=$('tcComposeInput');const body=input?.value.trim();if(!body)return;C.busy=true;try{const d=await rpc('chat_send_message',{p_employee_id:String(me()),p_conversation_id:C.activeId,p_body:body,p_message_type:'text',p_attachment_url:null,p_attachment_name:null,p_reply_to:null,p_session_token:token()});if(d.ok===false)throw new Error(d.message||'Message could not be sent.');input.value='';C.messages.push(d.message);renderMessages();await loadConversations()}catch(e){toast(e.message||String(e))}finally{C.busy=false}}
  async function sendFile(file){if(!file||!C.activeId)return;try{if(file.size>8*1024*1024)throw new Error('File must be 8 MB or smaller.');const path=`${me()}/${Date.now()}-${String(file.name).replace(/[^a-zA-Z0-9._-]/g,'_')}`;const up=await supabaseClient.storage.from('chat-attachments').upload(path,file,{upsert:false,contentType:file.type||undefined});if(up.error)throw up.error;const pub=supabaseClient.storage.from('chat-attachments').getPublicUrl(path);const d=await rpc('chat_send_message',{p_employee_id:String(me()),p_conversation_id:C.activeId,p_body:'',p_message_type:file.type?.startsWith('image/')?'image':'file',p_attachment_url:pub.data.publicUrl,p_attachment_name:file.name,p_reply_to:null,p_session_token:token()});if(d.ok===false)throw new Error(d.message||'Attachment failed.');C.messages.push(d.message);renderMessages();await loadConversations()}catch(e){toast(e.message||String(e))}finally{$('tcChatFile').value=''}}
  async function poll(){if(!me()||!C.activeId)return;try{const d=await rpc('chat_poll',{p_employee_id:String(me()),p_since:C.lastPoll,p_session_token:token()});C.lastPoll=new Date().toISOString();if(d.ok&&Array.isArray(d.messages)&&d.messages.length){const incoming=d.messages.filter(m=>String(m.conversationId)===String(C.activeId));const other=d.messages.filter(m=>String(m.conversationId)!==String(C.activeId));if(incoming.length){const ids=new Set(C.messages.map(m=>String(m.id)));incoming.forEach(m=>{if(!ids.has(String(m.id)))C.messages.push(m)});renderMessages();notify(incoming[incoming.length-1].senderName||'New message',incoming[incoming.length-1].body||'Attachment received')}if(other.length){other.forEach(m=>{const c=C.conversations.find(x=>String(x.id)===String(m.conversationId));if(c)c.unread=Number(c.unread||0)+1});renderList();}}}catch(e){console.warn('CHAT POLL',e)}}
  function openPage(){css();page();sidebar();loadConversations();if(C.poll)clearInterval(C.poll);C.poll=setInterval(()=>{if($('tc-chat-page')?.classList.contains('active'))poll()},3000);if('Notification' in window&&Notification.permission==='default')Notification.requestPermission().catch(()=>{});}
  function toggleDark(){const p=$('tc-chat-page');if(p)p.classList.toggle('tc-dark')}
  function closeModal(){$('tcChatModal')?.classList.remove('show')}
  function info(){renderRight()}
  function filterChats(v){renderList()}
  function requestNotification(){if('Notification' in window)Notification.requestPermission().catch(()=>{});toast('Browser notification permission requested.');}
  window.tcOpenPage=openPage;window.tcOpenConversation=openConversation;window.tcOpenNewChat=newChat;window.tcCloseNewChat=closeModal;window.tcRenderPeople=renderPeople;window.tcCreateSelectedChat=createSelected;window.tcOpenGroupCreator=groupCreator;window.tcCreateGroup=createGroup;window.tcSendMessage=send;window.tcSendFile=sendFile;window.tcFilterChats=filterChats;window.tcToggleDark=toggleDark;window.tcOpenInfo=info;window.tcRequestNotification=requestNotification;
  function boot(){css();page();sidebar();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
