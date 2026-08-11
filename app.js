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
    tasks: out.tasks || [],
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
        p_status: payload.status || 'Pending'
      };
      break;

    case 'createTask':
      rpcName = 'create_task';
      params = {
        p_employee_id: payload.employeeId || '',
        p_session_token: payload.sessionToken || getSessionToken(),
        p_task_type: payload.taskType || '',
        p_assigned_to: payload.assignedTo || '',
        p_priority: payload.priority || 'Medium',
        p_deadline: payload.deadline || null,
        p_reminder: payload.reminder || null,
        p_description: payload.description || '',
        p_file_url: payload.fileUrl || '',
        p_department: payload.taskDepartment || payload.department || 'Other',
        p_follow_up: payload.followUpTo || ''
      };
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

  const { data, error } = await supabaseClient.rpc(rpcName, params);
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

  if (action === 'uploadPhoto' && !isOwner()) {
    throw new Error('Only the Owner can change profile photos.');
  }

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

async function init(){
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
  const employeeId=document.getElementById('loginEmployeeId').value.trim(),
        password=document.getElementById('loginPassword').value,
        department=document.getElementById('loginDepartmentSelect').value;
  if(!employeeId||!password||!department){
    showLoginError('Please enter Employee ID, password and select department.');
    return;
  }
  const btn=document.querySelector('#loginScreen .btn-primary');
  if(btn)btn.disabled=true;
  try{
    const result=await direct('login',{employeeId,password,department});
    if(!result?.ok){
      showLoginError(result?.message||'Invalid login.');
      return;
    }
    APP.sessionToken=result.sessionToken||'';
    if(APP.sessionToken)localStorage.setItem('taskCommandSession',APP.sessionToken);
    const fresh=await direct('getData',{
      employeeId:result.member.employeeId,
      sessionToken:APP.sessionToken
    });
    APP={...APP,...fresh,sessionToken:APP.sessionToken};
    startSession(fresh.currentUser||result.member);
    document.getElementById('loginPassword').value='';
  }catch(e){
    showLoginError(e.message||String(e));
  }finally{
    if(btn)btn.disabled=false;
  }
}
function startSession(m){APP.currentUser=m;APP.filter=isOwner(m)?'all':'my';localStorage.setItem('taskCommandUserId',m.employeeId||'');if(APP.sessionToken)localStorage.setItem('taskCommandSession',APP.sessionToken);document.getElementById('loginScreen').style.display='none';document.getElementById('appDashboard').style.display='flex';applyRoleUI();updateProfileUI();renderAll();startLiveRefresh();document.getElementById('currentPageTitle').textContent=isOwner(m)?'Dashboard':'My Tasks';document.getElementById('taskTableHeading').textContent=isOwner(m)?'Live Task List':'My Tasks';toast('Welcome, '+m.name)}
function applyRoleUI(){const owner=isOwner();document.querySelectorAll('.owner-only').forEach(el=>el.classList.toggle('hidden-by-role',!owner));document.querySelectorAll('.photo-upload-overlay').forEach(el=>el.style.display=owner?'flex':'none');const dash=document.getElementById('dashboardNav');if(dash)dash.classList.toggle('hidden-by-role',!owner);}
function logout(){stopLiveRefresh();localStorage.removeItem('taskCommandUserId');localStorage.removeItem('taskCommandSession');APP.currentUser=null;APP.sessionToken='';document.getElementById('appDashboard').style.display='none';document.getElementById('loginScreen').style.display='flex';document.getElementById('loginEmployeeId').value='';document.getElementById('loginPassword').value='';document.getElementById('loginDepartmentSelect').value=''}
function showLoginError(msg){const e=document.getElementById('loginError');e.textContent=msg;e.style.display='block'}
async function loadData(silent=false){if(!APP.currentUser||isLoading)return;isLoading=true;try{const data=await direct('getData',{employeeId:APP.currentUser.employeeId});APP={...APP,...data};APP.currentUser=data.currentUser||APP.currentUser;applyRoleUI();renderAll();updateProfileUI();if(!silent)toast('Data refreshed')}catch(e){if(!silent)toast(e.message||e)}finally{isLoading=false}}
async function loadLive(silent=true){if(!APP.currentUser||isLoading)return;isLoading=true;try{const data=await direct('getLiveUpdates',{employeeId:APP.currentUser.employeeId});APP.tasks=data.tasks||[];APP.notifications=data.notifications||{};APP.announcements=data.announcements||APP.announcements;renderTasks();renderNotifications();renderAnnouncements();if(!silent)toast('Updated')}catch(e){}finally{isLoading=false}}
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
  if(APP.filter==='in-progress')tasks=tasks.filter(t=>String(t.status).toLowerCase()==='in progress');
  if(APP.filter==='pending')tasks=tasks.filter(t=>String(t.status).toLowerCase()==='pending');
  if(APP.filter==='open')tasks=tasks.filter(t=>String(t.status).toLowerCase()!=='completed');
  if(APP.filter==='completed')tasks=tasks.filter(t=>String(t.status).toLowerCase()==='completed');
  const body=document.getElementById('dashboardTaskTable'),mobile=document.getElementById('mobileTaskList');
  if(!tasks.length){body.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:30px">No tasks found.</td></tr>';mobile.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:25px">No tasks found.</div>';return}
  body.innerHTML=tasks.map(t=>{const overdue=t.deadline&&new Date(t.deadline+'T23:59:59')<new Date()&&String(t.status).toLowerCase()!=='completed';const p=String(t.priority||'Medium').toLowerCase();const status=t.status||'Pending';return `<tr class="task-row" onclick="openTaskDetails('${escapeHtml(t.id)}')"><td><b>${escapeHtml(t.id)}</b></td><td>${escapeHtml(t.taskType)}<div style="font-size:10px;color:var(--text-muted);margin-top:3px">${escapeHtml(t.taskDepartment||t.department||'Other')}</div></td><td>${escapeHtml(taskAssignedToText(t))}</td><td><span class="badge badge-${p}">${escapeHtml(t.priority)}</span></td><td>${escapeHtml(t.deadline||'—')}${overdue?' <span class="status-overdue">OVERDUE</span>':''}</td><td onclick="event.stopPropagation()"><select onchange="changeTaskStatus('${escapeHtml(t.id)}',this.value)" style="padding:5px;border:1px solid var(--border);border-radius:6px"><option ${status==='Pending'?'selected':''}>Pending</option><option ${status==='In Progress'?'selected':''}>In Progress</option><option ${status==='Completed'?'selected':''}>Completed</option></select></td><td>${escapeHtml(t.completedAt||'—')}</td><td onclick="event.stopPropagation()">${t.fileUrl?`<a class="btn-sm btn-success" href="${escapeHtml(t.fileUrl)}" target="_blank"><i class="fas fa-paperclip"></i></a>`:''}${isOwner()?`<button class="btn-sm btn-edit" onclick="editTask('${escapeHtml(t.id)}')"><i class="fas fa-pen"></i></button><button class="btn-sm btn-delete" onclick="deleteTask('${escapeHtml(t.id)}')"><i class="fas fa-trash"></i></button>`:''}</td></tr>`}).join('');
  mobile.innerHTML=tasks.map(t=>{const overdue=t.deadline&&new Date(t.deadline+'T23:59:59')<new Date()&&String(t.status).toLowerCase()!=='completed';const status=t.status||'Pending';return `<div class="mobile-task-card" onclick="openTaskDetails('${escapeHtml(t.id)}')"><div class="mobile-task-top"><div><div class="mobile-task-title">${escapeHtml(t.taskType)}</div><div class="mobile-task-id">${escapeHtml(t.id)} • ${escapeHtml(taskAssignedToText(t))} • ${escapeHtml(t.taskDepartment||t.department||'Other')}</div></div><span class="badge badge-${String(t.priority||'Medium').toLowerCase()}">${escapeHtml(t.priority)}</span></div><div class="mobile-task-meta"><div><span>Deadline</span><b>${escapeHtml(t.deadline||'—')}</b>${overdue?' <span class="status-overdue">OVERDUE</span>':''}</div><div><span>Assigned By</span><b>${escapeHtml(t.createdByName||'—')}</b></div></div><div class="mobile-task-bottom" onclick="event.stopPropagation()"><select onchange="changeTaskStatus('${escapeHtml(t.id)}',this.value)"><option ${status==='Pending'?'selected':''}>Pending</option><option ${status==='In Progress'?'selected':''}>In Progress</option><option ${status==='Completed'?'selected':''}>Completed</option></select><button onclick="openTaskDetails('${escapeHtml(t.id)}')"><i class="fas fa-eye"></i></button></div></div>`}).join('');
  renderDashboardStats();
}
async function changeTaskStatus(id,status){const t=APP.tasks.find(x=>x.id===id);if(!t)return;const old={status:t.status,completedAt:t.completedAt};t.status=status;t.completedAt=status==='Completed'?new Date().toISOString():'';renderTasks();try{await api('updateTaskStatus',{employeeId:APP.currentUser.employeeId,taskId:id,status});toast('Task status updated');await loadLive(true)}catch(e){t.status=old.status;t.completedAt=old.completedAt;renderTasks();toast(e.message||String(e))}}
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
function renderDashboardStats(){const all=APP.tasks||[];const open=all.filter(t=>String(t.status||'Pending').toLowerCase()!=='completed').length;const pending=all.filter(t=>String(t.status||'Pending').toLowerCase()==='pending').length;const progress=all.filter(t=>String(t.status||'').toLowerCase()==='in progress').length;const completed=all.filter(t=>String(t.status||'').toLowerCase()==='completed').length;[['countOpen',open],['countPending',pending],['countProgress',progress],['countCompleted',completed]].forEach(([id,n])=>{const el=document.getElementById(id);if(el)el.textContent=n})}
function renderGreeting(){const m=APP.currentUser;if(!m)return;const h=new Date().getHours();const greeting=h<12?'Good Morning':h<17?'Good Afternoon':'Good Evening';const el=document.getElementById('greetingText');const sub=document.getElementById('greetingSubtext');const dept=document.getElementById('dashboardDepartment');if(el)el.textContent=greeting+', '+m.name+' 👋';if(sub)sub.textContent=isOwner(m)?'Here is your team task overview for today.':'Here is your personal task overview for today.';if(dept)dept.textContent='Department: '+(m.department||'Other')}
function openCountDetails(type){let filter='my';let title='My Tasks';if(type==='completed'){filter='completed';title='Completed'}else if(type==='in-progress'){filter='in-progress';title='In Progress'}else if(type==='pending'){filter='pending';title='Pending'}else if(type==='open'){filter='open';title='Open Tasks'}APP.filter=filter;document.getElementById('currentPageTitle').textContent=title;document.getElementById('taskTableHeading').textContent=title;showPage('dashboard-page');renderTasks()}

function renderMembers(){const body=document.getElementById('memberTableBody');if(!body)return;body.innerHTML=APP.members.map((m,i)=>{const count=APP.tasks.filter(t=>taskAssignedToMe(t,m.name)&&String(t.status).toLowerCase()==='completed').length;return `<tr><td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.role)}</td><td>${escapeHtml(m.email)}</td><td>${escapeHtml(m.phone)}</td><td>${escapeHtml(m.department||'—')}</td><td><b>${count}</b></td><td>${isOwner()?`<button class="btn-sm btn-edit" onclick="editMember(${i})">Edit</button><button class="btn-sm btn-delete" onclick="deleteMember(${i})">Delete</button>`:'View only'}</td></tr>`}).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No members yet.</td></tr>'}
function renderTeamList(){const el=document.getElementById('teamList');if(!el)return;el.innerHTML=APP.members.map(m=>`<div class="team-person"><div class="team-avatar">${m.photo?`<img src="${escapeHtml(m.photo)}">`:initials(m.name)}</div><div><h4>${escapeHtml(m.name)}</h4><p>${escapeHtml(m.role||'Team Member')}</p><span class="dept">${escapeHtml(m.department||'Other')}</span></div></div>`).join('')||'<p style="color:var(--text-muted)">No team members.</p>'}
async function saveMember(e){e.preventDefault();if(!isOwner()){toast('Only the Owner can manage members.');return}const i=Number(document.getElementById('editMemberIndex').value),name=document.getElementById('memberName').value.trim();const m={name,role:document.getElementById('memberRole').value.trim(),email:document.getElementById('memberEmail').value.trim(),phone:document.getElementById('memberPhone').value.trim(),photo:'',employeeId:name.toLowerCase().replace(/\s+/g,''),password:name.toLowerCase().replace(/\s+/g,'')+'@123',department:document.getElementById('memberDepartment').value,joiningDate:new Date().toISOString().slice(0,10),updatedAt:new Date().toISOString()};if(i>=0){m.photo=APP.members[i].photo||'';m.employeeId=APP.members[i].employeeId||m.employeeId;m.password=APP.members[i].password||m.password;APP.members[i]=m}else APP.members.push(m);try{await persist();renderAll();e.target.reset();document.getElementById('editMemberIndex').value=-1;toast(i>=0?'Member updated':'Member added')}catch(err){toast(err.message||err)}}
function editMember(i){if(!isOwner())return;const m=APP.members[i];document.getElementById('editMemberIndex').value=i;document.getElementById('memberName').value=m.name;document.getElementById('memberRole').value=m.role;document.getElementById('memberEmail').value=m.email;document.getElementById('memberPhone').value=m.phone;document.getElementById('memberDepartment').value=String(m.department||'').toLowerCase()}
async function deleteMember(i){if(!isOwner()||!confirm('Delete this member?'))return;APP.members.splice(i,1);try{await persist();renderAll();toast('Member deleted')}catch(e){toast(e.message||String(e))}}
function addNotification(user,message,type){if(!APP.notifications[user])APP.notifications[user]=[];APP.notifications[user].unshift({message,type,createdAt:new Date().toISOString(),read:false})}
function renderNotifications(){const list=APP.notifications?.[APP.currentUser?.name]||[];const unread=list.filter(x=>!x.read).length;document.getElementById('notifCount').textContent=unread;document.getElementById('notifList').innerHTML=list.length?list.slice(0,25).map(n=>`<div class="notif-item"><b>${escapeHtml(n.type||'Update')}</b> — ${escapeHtml(n.message)}<br><small style="color:var(--text-muted)">${new Date(n.createdAt).toLocaleString()}</small></div>`).join(''):'<p style="font-size:.75rem;color:var(--text-muted);text-align:center;padding:10px">No new notifications</p>'}
function toggleNotificationDropdown(){document.getElementById('notifDropdown').classList.toggle('show');const list=APP.notifications?.[APP.currentUser?.name]||[];list.forEach(n=>n.read=true);renderNotifications()}
function renderAnnouncements(){const list=APP.announcements||[];const el=document.getElementById('announcementList');if(!el)return;if(!list.length){el.innerHTML='<div class="announcement-empty">No announcements yet. Stay tuned for company updates.</div>';return}el.innerHTML=list.slice(0,10).map(a=>`<div class="announcement-card"><div class="ann-type">${escapeHtml(a.type)} • ${escapeHtml(a.createdByName||'Admin')}</div><h4>${escapeHtml(a.title)}</h4><div class="ann-desc">${safeRich(a.description)}</div><small>${a.createdAt?new Date(a.createdAt).toLocaleString():''}${a.fileUrl?` • <a href="${escapeHtml(a.fileUrl)}" target="_blank" style="color:#fff;text-decoration:underline">Attachment</a>`:''}</small></div>`).join('')}
function openAnnouncementModal(){if(!isOwner()){toast('Only Owner can post announcements.');return}document.getElementById('announcementModal').classList.add('show')}
function closeAnnouncementModal(){document.getElementById('announcementModal').classList.remove('show')}
function selectAnnouncementType(btn){document.querySelectorAll('.event-chip').forEach(x=>x.classList.remove('active'));btn.classList.add('active');selectedAnnouncementType=btn.dataset.type}
function execAnnouncementCmd(cmd){document.execCommand(cmd,false,null);document.getElementById('annDescription').focus()}
async function publishAnnouncement(){if(!isOwner())return;const title=document.getElementById('annTitle').value.trim(),description=document.getElementById('annDescription').innerHTML.trim();if(!title||!description){toast('Add a title and description.');return}const f=document.getElementById('annFile').files[0];const btn=document.getElementById('publishAnnouncementBtn');btn.disabled=true;try{let fileUrl='';if(f)fileUrl=await uploadFile(f,'uploadTaskFile','Announcement');await api('createAnnouncement',{employeeId:APP.currentUser.employeeId,title,description,type:selectedAnnouncementType,fileUrl});document.getElementById('annTitle').value='';document.getElementById('annDescription').innerHTML='';document.getElementById('annFile').value='';closeAnnouncementModal();await loadData(true);toast('Announcement published')}catch(e){toast(e.message||String(e))}finally{btn.disabled=false}}
async function renderReportSummary(){const el=document.getElementById('reportSummary');if(!el||!APP.currentUser)return;try{const employee=isOwner()?((document.getElementById('reportEmployee')||{}).value||'ALL'):APP.currentUser.name;const period=(document.getElementById('reportPeriod')||{}).value||'all';const r=await api('getTaskReport',{employeeId:APP.currentUser.employeeId,employee,period});const tasks=r.tasks||[];const p=tasks.filter(t=>String(t.status).toLowerCase()==='pending').length;const ip=tasks.filter(t=>String(t.status).toLowerCase()==='in progress').length;const c=tasks.filter(t=>String(t.status).toLowerCase()==='completed').length;el.innerHTML=`<span class="summary-pill">Total: ${tasks.length}</span><span class="summary-pill">Pending: ${p}</span><span class="summary-pill">In Progress: ${ip}</span><span class="summary-pill">Completed: ${c}</span>`}catch(e){}}
async function downloadBase64File(base64,mimeType,fileName){
  const binary=atob(base64);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  const blob=new Blob([bytes],{type:mimeType||'application/octet-stream'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=fileName||'TASK_COMMAND_REPORT';document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function downloadTaskReport(kind){
  if(!APP.currentUser)return;
  const buttons=document.querySelectorAll('.report-btn');
  buttons.forEach(b=>b.disabled=true);
  try{
    const employee=isOwner()?((document.getElementById('reportEmployee')||{}).value||'ALL'):APP.currentUser.name;
    const period=(document.getElementById('reportPeriod')||{}).value||'all';
    const r=await api('getTaskReport',{employeeId:APP.currentUser.employeeId,employee,period});
    const tasks=r.tasks||[];
    const rows=tasks.map(t=>({
      'Task ID':t.id||'',
      'Task Type':t.taskType||'',
      'Department':t.department||t.taskDepartment||'Other',
      'Assigned To':taskAssignedToText(t),
      'Assigned By':t.createdByName||'',
      'Follow-up':t.followUpTo||'',
      'Priority':t.priority||'Medium',
      'Deadline':t.deadline||'',
      'Status':t.status||'Pending',
      'Created At':t.createdAt||'',
      'Completed At':t.completedAt||''
    }));
    const stamp=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const base='TASK_COMMAND_'+String(employee||'ALL').replace(/[^a-z0-9]+/gi,'_')+'_'+period+'_'+stamp;

    if(kind==='csv'){
      const headers=Object.keys(rows[0]||{
        'Task ID':'','Task Type':'','Department':'','Assigned To':'','Assigned By':'',
        'Follow-up':'','Priority':'','Deadline':'','Status':'','Created At':'','Completed At':''
      });
      const csv=[headers.join(','),...rows.map(row=>headers.map(h=>{
        const v=String(row[h]??'').replace(/"/g,'""');
        return '"'+v+'"';
      }).join(','))].join('\r\n');
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download=base+'.csv';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      toast('CSV downloaded — '+tasks.length+' task(s)');
      return;
    }

    if(kind==='xlsx'){
      if(!window.XLSX)throw new Error('Excel export library is not loaded. Refresh the page and try again.');
      const ws=XLSX.utils.json_to_sheet(rows);
      const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,ws,'Task Report');
      XLSX.writeFile(wb,base+'.xlsx');
      toast('Excel downloaded — '+tasks.length+' task(s)');
      return;
    }

    if(kind==='pdf'){
      if(!window.jspdf?.jsPDF)throw new Error('PDF export library is not loaded. Refresh the page and try again.');
      const doc=new jspdf.jsPDF({orientation:'landscape',unit:'pt',format:'a4'});
      doc.setFontSize(20);
      doc.setTextColor(23,59,143);
      doc.text('TASK COMMAND',doc.internal.pageSize.getWidth()/2,38,{align:'center'});
      doc.setFontSize(11);
      doc.setTextColor(91,55,255);
      doc.text('TASK PERFORMANCE REPORT',doc.internal.pageSize.getWidth()/2,56,{align:'center'});
      doc.setFontSize(9);
      doc.setTextColor(100,116,139);
      doc.text('Employee: '+employee+'   •   Period: '+String(period).toUpperCase()+'   •   Generated: '+new Date().toLocaleString(),doc.internal.pageSize.getWidth()/2,72,{align:'center'});

      const total=tasks.length;
      const completed=tasks.filter(t=>String(t.status).toLowerCase()==='completed').length;
      const pending=tasks.filter(t=>String(t.status).toLowerCase()==='pending').length;
      const progress=tasks.filter(t=>String(t.status).toLowerCase()==='in progress').length;

      doc.setFontSize(10);
      doc.setTextColor(23,32,51);
      doc.text('Total: '+total+'    Completed: '+completed+'    Pending: '+pending+'    In Progress: '+progress,40,96);

      const head=[['TASK ID','TASK TYPE','DEPARTMENT','ASSIGNED TO','ASSIGNED BY','PRIORITY','DEADLINE','STATUS']];
      const body=tasks.map(t=>[
        t.id||'',
        t.taskType||'',
        t.department||t.taskDepartment||'Other',
        taskAssignedToText(t),
        t.createdByName||'—',
        t.priority||'Medium',
        t.deadline||'—',
        t.status||'Pending'
      ]);

      if(typeof doc.autoTable==='function'){
        doc.autoTable({
          head,
          body,
          startY:110,
          styles:{fontSize:7,cellPadding:4},
          headStyles:{fillColor:[23,59,143],textColor:255},
          alternateRowStyles:{fillColor:[247,249,252]}
        });
      }else{
        let y=115;
        doc.setFontSize(7);
        head[0].forEach((h,i)=>doc.text(h,40+i*90,y));
        y+=14;
        body.forEach(row=>{
          row.forEach((v,i)=>doc.text(String(v).slice(0,18),40+i*90,y));
          y+=12;
          if(y>550){doc.addPage();y=40;}
        });
      }

      doc.save(base+'.pdf');
      toast('PDF downloaded — '+tasks.length+' task(s)');
      return;
    }

    throw new Error('Unknown report format.');
  }catch(e){
    toast(e.message||String(e));
  }finally{
    buttons.forEach(b=>b.disabled=false);
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
async function uploadProfilePhoto(e){const f=e.target.files[0];if(!f||!APP.currentUser)return;if(!isOwner()){toast('Only the Owner can change profile photos.');e.target.value='';return}try{const url=await uploadFile(f,'uploadPhoto',APP.currentUser.name);const res=await api('updateOwnProfile',{employeeId:APP.currentUser.employeeId,phone:APP.currentUser.phone,email:APP.currentUser.email,photo:url});APP.currentUser=res.member;APP.members=APP.members.map(x=>x.employeeId===APP.currentUser.employeeId?res.member:x);updateProfileUI();fillProfile(APP.currentUser);toast('Profile photo updated')}catch(err){toast(err.message||err)}e.target.value=''}
function execCmd(cmd){document.execCommand(cmd,false,null);document.getElementById('fullDescription').focus()}
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&(document.activeElement===document.getElementById('loginEmployeeId')||document.activeElement===document.getElementById('loginPassword')))login();if(e.key==='Escape'){closeTaskDetails();closeAnnouncementModal()}});
window.addEventListener('load',init);

document.addEventListener('click',function(e){const wrap=document.getElementById('multiAssignee');if(wrap&&!wrap.contains(e.target))closeAssigneePicker();});
