/* TASK COMMAND - complete Supabase data engine */
const STORAGE={loggedUser:'taskCommand_loggedUser_v6'};
let members=[],taskList=[],notifications=[],departments=[],announcements=[],loggedEmployee=null,loggedUser=localStorage.getItem(STORAGE.loggedUser)||'',currentFilter='all',selectedAssignees=[],realtimeChannel=null,refreshBusy=false,reminderTimer=null;

const $=id=>document.getElementById(id);
const norm=v=>String(v??'').trim().toLowerCase();
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const initials=n=>String(n||'Employee').trim().split(/\s+/).filter(Boolean).map(x=>x[0]).join('').slice(0,2).toUpperCase()||'E';
const me=()=>loggedEmployee||members.find(x=>norm(x.name)===norm(loggedUser)||norm(x.login_id)===norm(loggedUser))||{id:null,name:loggedUser||'Employee',role:'employee'};
const isAdminUser=()=>['owner','admin'].includes(norm(me().role));
const isEmployee=()=>norm(me().role)==='employee';
const fmt=v=>v?new Date(v).toLocaleString():'-';

async function loadAllData(){
  const rs=await Promise.all([
    supabaseClient.from('departments').select('*').eq('is_active',true).order('name'),
    supabaseClient.from('employees').select('id,name,login_id,role,department,email,phone,profile_photo_url,is_active').eq('is_active',true).order('name'),
    supabaseClient.from('tasks').select('*').order('created_at',{ascending:false}),
    supabaseClient.from('task_assignees').select('*'),
    supabaseClient.from('notifications').select('*').order('created_at',{ascending:false}),
    supabaseClient.from('task_attachments').select('*').order('created_at',{ascending:false}),
    supabaseClient.from('announcements').select('*').order('published_at',{ascending:false}),
    supabaseClient.from('announcement_reactions').select('*')
  ]);
  const bad=rs.find(r=>r.error);if(bad)throw bad.error;
  departments=rs[0].data||[];members=rs[1].data||[];
  const byId=Object.fromEntries(members.map(x=>[String(x.id),x])),assignees=rs[3].data||[],files=rs[5].data||[];
  taskList=(rs[2].data||[]).map(t=>{
    const aa=assignees.filter(a=>String(a.task_id)===String(t.id));
    return {
      dbId:t.id,id:t.task_id||t.id,taskType:t.task_type||'Task',desc:t.description||'',
      assignedBy:t.assigned_by_name||byId[String(t.created_by)]?.name||'-',
      assignedTo:aa.map(a=>byId[String(a.employee_id)]?.name).filter(Boolean).join(', ')||'-',
      assigneeIds:aa.map(a=>String(a.employee_id)),priority:t.priority||'Medium',
      deadline:t.deadline||null,reminder:t.reminder_at||null,
      status:t.status==='in-progress'?'In Progress':t.status==='completed'?'Completed':t.status==='under-review'?'Under Review':t.status==='cancelled'?'Cancelled':'Pending',
      completedAt:t.completed_at,department:t.department||'',createdAt:t.created_at,createdBy:t.created_by,
      attachments:files.filter(f=>String(f.task_id)===String(t.id))
    };
  });
  notifications=(rs[4].data||[]).filter(n=>me().id&&String(n.employee_id)===String(me().id));
  announcements=(rs[6].data||[]).map(a=>({...a,reactions:(rs[7].data||[]).filter(r=>String(r.announcement_id)===String(a.id))}));
  renderAll();
}
function renderAll(){renderRoleUI();renderUser();renderStats();renderTasks();renderAssignees();renderMembers();renderTeam();renderNotifications();renderAnnouncements();populateReportEmployees();updateReportDates();}

function renderRoleUI(){
  document.querySelectorAll('.admin-only').forEach(x=>x.classList.toggle('hidden',!isAdminUser()));
  document.querySelectorAll('.owner-only').forEach(x=>x.classList.toggle('hidden',!isAdminUser()));
  document.querySelectorAll('.owner-only-page').forEach(x=>x.classList.toggle('hidden',!isAdminUser()));
  const photoButtons=document.querySelectorAll('.photo-upload-overlay,.profile-actions .secondary');
  photoButtons.forEach(x=>x.classList.toggle('hidden',!isAdminUser()));
}
function renderUser(){
  const u=me(),photo=u.profile_photo_url;
  ['userProfileName'].forEach(id=>{if($(id))$(id).textContent=u.name||'Employee'});
  ['sidebarUserRole'].forEach(id=>{if($(id))$(id).textContent=`${u.role||'User'}${u.department?' • '+u.department:''}`});
  const headerName=document.querySelector('#headerUserName');if(headerName)headerName.textContent=u.name||'Employee';
  const headerRole=document.querySelector('#headerUserRole');if(headerRole)headerRole.textContent=u.role||'User';
  document.querySelectorAll('.avatar,#headerAvatar,#profileBigAvatar').forEach(el=>{el.innerHTML=photo?`<img src="${esc(photo)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`:esc(initials(u.name));});
  const set=(id,v)=>{if($(id))$(id).textContent=v||'Not added'};
  set('profileFullName',u.name);set('profileRole',u.role);set('profileRole2',u.role);set('profilePhone',u.phone);set('profileEmail',u.email);set('profileDepartment',u.department);set('profileEmployeeId',u.login_id||u.id);
}

async function handleLogin(){
  const login=$('loginId')?.value.trim() || "";
  const password=$('loginPass')?.value || "";
  const err=$('loginError');

  if(err){
    err.style.display='none';
    err.textContent='';
  }

  if(!login || !password){
    if(err){
      err.textContent='Please enter login ID and password.';
      err.style.display='block';
    }
    return;
  }

  const btn=document.querySelector('#loginScreen button.btn-primary');
  const oldText=btn ? btn.innerHTML : "";

  try{
    if(btn){
      btn.disabled=true;
      btn.innerHTML='<i class="fas fa-spinner fa-spin"></i>&nbsp; LOGGING IN...';
    }

    // Direct employee lookup keeps login independent of the login_employee RPC.
    // This preserves the rest of the existing application flow.
    const result=await supabaseClient
      .from('employees')
      .select('id,name,login_id,password_hash,role,department,email,phone,profile_photo_url,is_active')
      .eq('is_active',true);

    if(result.error) throw result.error;

    const employees=result.data || [];
    const user=employees.find(x =>
      norm(x.login_id)===norm(login) ||
      norm(x.name)===norm(login)
    );

    if(!user) throw new Error('Invalid Name or Password!');

    // Existing index.html loads bcryptjs before app.js.
    if(!window.bcrypt || typeof window.bcrypt.compareSync!=='function'){
      throw new Error('Password system is not loaded. Please refresh the page.');
    }

    const valid=window.bcrypt.compareSync(
      password,
      user.password_hash || ""
    );

    if(!valid) throw new Error('Invalid Name or Password!');

    loggedEmployee={
      id:user.id,
      name:user.name,
      login_id:user.login_id,
      role:user.role,
      department:user.department,
      email:user.email,
      phone:user.phone,
      profile_photo_url:user.profile_photo_url,
      is_active:user.is_active
    };

    loggedUser=user.name;
    localStorage.setItem(STORAGE.loggedUser,loggedUser);

    // Keep the original working application startup sequence.
    await loadAllData();
    showApp();
    subscribeRealtime();
    requestNotificationPermission();
    startReminderChecks();

  }catch(e){
    console.error('LOGIN ERROR:',e);
    if(err){
      err.textContent=e?.message || 'Login failed.';
      err.style.display='block';
    }
  }finally{
    if(btn){
      btn.disabled=false;
      btn.innerHTML=oldText || '<i class="fas fa-arrow-right-to-bracket"></i>&nbsp; LOGIN';
    }
  }
}
function showApp(){
  $('loginScreen').style.display='none';$('appDashboard').style.display='flex';
  currentFilter=isEmployee()?'my':'all';renderAll();
  const dashboard=document.querySelector('.nav-item');if(dashboard)switchTaskFilter(currentFilter==='my'?'my':'all',currentFilter==='my'?'My Tasks':'Dashboard',dashboard);
}
function logout(){
  localStorage.removeItem(STORAGE.loggedUser);loggedUser='';loggedEmployee=null;
  if(realtimeChannel)supabaseClient.removeChannel(realtimeChannel);if(reminderTimer)clearInterval(reminderTimer);location.reload();
}

function openProfileModal(){$('profileModal')?.classList.add('show');renderUser()}
function closeProfileModal(){$('profileModal')?.classList.remove('show')}
function openProfilePhotoPicker(){
  if(!isAdminUser())return alert('Employee profile photo changes are disabled. Only Owner/Admin can change profile photos.');
  $('profilePhotoInput')?.click();
}
async function uploadProfilePhoto(event){
  if(!isAdminUser()){event.target.value='';return alert('Employee profile photo changes are disabled.');}
  const file=event.target.files?.[0],u=me();if(!file||!u.id)return;
  if(!file.type.startsWith('image/')){alert('Please select an image.');event.target.value='';return}
  if(file.size>5*1024*1024){alert('Image must be 5 MB or smaller.');event.target.value='';return}
  try{
    const path=`profiles/${u.id}/profile-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    const r=await supabaseClient.storage.from('task-command-files').upload(path,file,{upsert:false,contentType:file.type});
    if(r.error)throw r.error;
    const pub=supabaseClient.storage.from('task-command-files').getPublicUrl(path).data.publicUrl;
    const db=await supabaseClient.from('employees').update({profile_photo_url:pub}).eq('id',u.id);
    if(db.error)throw db.error;
    loggedEmployee={...u,profile_photo_url:pub};await loadAllData();alert('Profile photo updated.');
  }catch(e){alert('Photo upload failed: '+(e.message||e))}
  finally{event.target.value='';}
}

function switchPage(pageId,title,element){
  if((pageId==='add-member-page'||pageId==='team-page')&&!isAdminUser())return;
  document.querySelectorAll('.modal-page').forEach(p=>p.classList.remove('active'));
  $(pageId)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));element?.classList.add('active');
  if($('currentPageTitle'))$('currentPageTitle').textContent=title;
  if(innerWidth<=768){$('sidebar')?.classList.remove('open');$('sidebarOverlay')?.classList.remove('active')}
}
function switchTaskFilter(type,title,element){
  currentFilter=type;switchPage('dashboard-page',title,element);renderTasks();
}

function visibleTasks(){
  let list=isAdminUser()?(currentFilter==='my'?taskList.filter(t=>t.assigneeIds.includes(String(me().id))):taskList):taskList.filter(t=>t.assigneeIds.includes(String(me().id)));
  if(currentFilter==='pending')list=list.filter(t=>t.status==='Pending');
  if(currentFilter==='in-progress')list=list.filter(t=>t.status==='In Progress');
  if(currentFilter==='completed')list=list.filter(t=>t.status==='Completed');
  return list;
}
function renderStats(){
  const list=isAdminUser()?taskList:taskList.filter(t=>t.assigneeIds.includes(String(me().id)));
  if($('statPending'))$('statPending').textContent=list.filter(t=>t.status==='Pending').length;
  if($('statProgress'))$('statProgress').textContent=list.filter(t=>t.status==='In Progress').length;
  if($('statCompleted'))$('statCompleted').textContent=list.filter(t=>t.status==='Completed').length;
  if($('statTotal'))$('statTotal').textContent=list.length;
}
function renderTasks(){
  const tbody=$('dashboardTaskTable');if(!tbody)return;
  const list=visibleTasks();if(!list.length){tbody.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:30px;">No tasks found.</td></tr>';return}
  const today=new Date().toISOString().slice(0,10);
  tbody.innerHTML=list.map(t=>{
    const badge=t.priority==='High'?'badge-high':t.priority==='Low'?'badge-low':'badge-medium';
    const overdue=t.deadline&&t.deadline<today&&t.status!=='Completed';
    const canManage=isAdminUser()||t.assigneeIds.includes(String(me().id));
    return `<tr class="task-row" onclick="openTaskDetails('${esc(t.id)}')">
      <td><b>${esc(t.id)}</b></td><td><b>${esc(t.taskType)}</b><br><small>${esc(t.department)}</small></td>
      <td><b>${esc(t.assignedTo)}</b><br><small>By: ${esc(t.assignedBy)}</small></td>
      <td><span class="badge ${badge}">${esc(t.priority)}</span></td>
      <td>${overdue?'<span class="status-overdue">OVERDUE</span><br>':''}${esc(t.deadline||'No Deadline')}</td>
      <td><select ${canManage?'':'disabled'} onclick="event.stopPropagation()" onchange="event.stopPropagation();updateStatus('${esc(t.id)}',this.value)" style="padding:4px;border-radius:4px;">
        ${['Pending','In Progress','Under Review','Completed'].map(s=>`<option ${s===t.status?'selected':''}>${s}</option>`).join('')}</select></td>
      <td><small>${esc(fmt(t.createdAt))}</small></td>
      <td>${isAdminUser()?`<button class="btn-sm btn-edit" onclick="event.stopPropagation();editTask('${esc(t.id)}')">Edit</button><button class="btn-sm btn-delete" onclick="event.stopPropagation();deleteTask('${esc(t.id)}')">Delete</button>`:'<span style="font-size:.72rem;color:var(--text-muted)">View details</span>'}</td>
    </tr>`;
  }).join('');
  const h=$('taskTableHeading');if(h)h.textContent=currentFilter==='my'?'My Assigned Tasks':currentFilter==='all'?'All Tasks':currentFilter==='pending'?'Pending Tasks':currentFilter==='in-progress'?'In Progress Tasks':'Completed Tasks';
}
function openTaskDetails(id){
  const t=taskList.find(x=>String(x.id)===String(id));if(!t)return;
  $('taskDetailCategory').textContent=t.department||'TASK';
  $('taskDetailTitle').textContent=t.taskType;
  const items=[['Task ID',t.id],['Assigned By',t.assignedBy],['Assigned To',t.assignedTo],['Created',fmt(t.createdAt)],['Deadline',t.deadline||'No Deadline'],['Status',t.status],['Priority',t.priority],['Reminder',fmt(t.reminder)],['Completed',fmt(t.completedAt)]];
  $('taskDetailGrid').innerHTML=items.map(x=>`<div class="task-detail-item"><small>${esc(x[0])}</small><b>${esc(x[1])}</b></div>`).join('');
  $('taskDetailDescription').innerHTML=t.desc||'<i>No description provided.</i>';
  const byId=Object.fromEntries(members.map(m=>[String(m.id),m]));
  $('taskDetailTeam').innerHTML=t.assigneeIds.length?t.assigneeIds.map(id=>{const m=byId[String(id)];return `<span class="team-chip"><span class="mini-avatar">${m?.profile_photo_url?`<img src="${esc(m.profile_photo_url)}">`:esc(initials(m?.name))}</span>${esc(m?.name||id)}${m?.department?` • ${esc(m.department)}`:''}</span>`}).join(''):'No team members assigned.';
  $('taskDetailFiles').innerHTML=t.attachments.length?t.attachments.map(a=>`<a href="${esc(a.file_url)}" target="_blank" rel="noopener" style="display:block;margin:6px 0;color:var(--primary)"><i class="fas fa-paperclip"></i> ${esc(a.file_name)}</a>`).join(''):'No attached files.';
  $('taskDetailsModal').classList.add('show');
}
function closeTaskDetails(){$('taskDetailsModal')?.classList.remove('show')}

function renderAssignees(){
  const employees=members.filter(m=>norm(m.role)==='employee');
  if($('quickAssignee'))$('quickAssignee').innerHTML='<option value="">Select employee</option>'+employees.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  if($('fullAssignee'))$('fullAssignee').innerHTML='<option value="">Select employee</option>'+employees.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  const box=$('multiAssigneeBox');if(box){
    box.innerHTML=`<button type="button" onclick="toggleAssigneePicker()" style="width:100%;padding:8px;border:1px solid var(--border);background:#fff;border-radius:8px;text-align:left">Multiple assignees: <b id="selectedAssigneeCount">0 selected</b></button><div id="assigneePicker" style="display:none;margin-top:5px;padding:8px;border:1px solid var(--border);border-radius:8px;max-height:170px;overflow:auto"></div>`;
    const p=$('assigneePicker');p.innerHTML=employees.map(m=>`<label style="display:block;padding:7px"><input type="checkbox" value="${esc(m.id)}" onchange="syncAssignees()"> ${esc(m.name)}</label>`).join('');
    syncAssignees();
  }
  if($('fullDepartment'))$('fullDepartment').innerHTML=departments.map(d=>`<option>${esc(d.name)}</option>`).join('')||'<option>Other</option>';
}
function toggleAssigneePicker(){$('assigneePicker').style.display=$('assigneePicker').style.display==='none'?'block':'none'}
function syncAssignees(){selectedAssignees=[...document.querySelectorAll('#assigneePicker input:checked')].map(x=>String(x.value));if($('selectedAssigneeCount'))$('selectedAssigneeCount').textContent=`${selectedAssignees.length} selected`;if($('fullAssignee'))$('fullAssignee').value=selectedAssignees[0]||''}
function setSelectedAssignees(ids){setTimeout(()=>{document.querySelectorAll('#assigneePicker input').forEach(x=>x.checked=(ids||[]).map(String).includes(String(x.value)));syncAssignees()},0)}

async function uploadFile(file,folder){
  if(!file)return null;
  const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),path=`${folder}/${Date.now()}_${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}_${safe}`;
  const r=await supabaseClient.storage.from('task-command-files').upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'});if(r.error)throw r.error;
  return {path,url:supabaseClient.storage.from('task-command-files').getPublicUrl(path).data.publicUrl,name:file.name,type:file.type,size:file.size};
}
async function submitFullTask(e){
  e.preventDefault();if(!isAdminUser())return alert('Only Owner/Admin can assign tasks.');
  try{
    const editId=$('editTaskId').value,type=$('fullTaskType').value,ids=[...selectedAssignees];
    if(!type||!ids.length)return alert('Select a task and at least one employee.');
    const payload={task_type:type,department:$('fullDepartment').value,description:$('fullDescription').innerHTML,priority:$('fullPriority').value,status:'pending',deadline:$('fullDeadline').value||null,reminder_at:$('fullReminder').value||null,created_by:me().id,assigned_by_name:me().name};
    let task;
    if(editId){
      const old=taskList.find(t=>String(t.dbId)===String(editId));if(!old)throw new Error('Task not found');
      const r=await supabaseClient.from('tasks').update(payload).eq('id',old.dbId).select().single();if(r.error)throw r.error;task=r.data;
      await supabaseClient.from('task_assignees').delete().eq('task_id',task.id);
    }else{
      const r=await supabaseClient.from('tasks').insert(payload).select().single();if(r.error)throw r.error;task=r.data;
    }
    const ar=await supabaseClient.from('task_assignees').insert(ids.map(employee_id=>({task_id:task.id,employee_id})));if(ar.error)throw ar.error;
    const file=await uploadFile($('fullTaskFile').files?.[0],`tasks/${task.id}`);
    if(file)await supabaseClient.from('task_attachments').insert({task_id:task.id,file_name:file.name,file_url:file.url,storage_path:file.path,file_type:file.type,file_size:file.size,uploaded_by:me().id});
    if(!editId)await supabaseClient.from('notifications').insert(ids.map(employee_id=>({employee_id,task_id:task.id,type:'task',title:'New Task Assigned',message:`New task assigned: ${type}`,is_read:false})));
    $('editTaskId').value='';$('fullDescription').innerHTML='';$('fullTaskFile').value='';selectedAssignees=[];await loadAllData();alert(editId?'Task updated successfully.':'Task assigned successfully.');
  }catch(e){console.error(e);alert(e.message||e)}
}
async function createQuickTask(){
  if(!isAdminUser())return;
  const title=$('quickTitle').value.trim(),assignee=$('quickAssignee').value;if(!title||!assignee)return alert('Please enter Task Title and select a Team Member.');
  const r=await supabaseClient.from('tasks').insert({task_type:title,department:me().department||'Other',description:'',priority:$('quickPriority').value,status:'pending',deadline:$('quickDueDate').value||null,created_by:me().id,assigned_by_name:me().name}).select().single();if(r.error)return alert(r.error.message);
  await supabaseClient.from('task_assignees').insert({task_id:r.data.id,employee_id:assignee});
  await supabaseClient.from('notifications').insert({employee_id:assignee,task_id:r.data.id,type:'task',title:'New Task Assigned',message:`New task assigned: ${title}`,is_read:false});
  $('quickTitle').value='';$('quickDueDate').value='';await loadAllData();
}
function editTask(id){
  if(!isAdminUser())return;const t=taskList.find(x=>String(x.id)===String(id));if(!t)return;
  $('editTaskId').value=t.dbId;$('fullTaskType').value=t.taskType;$('fullAssignee').value=t.assigneeIds[0]||'';$('fullPriority').value=t.priority;$('fullDeadline').value=t.deadline||'';$('fullReminder').value=t.reminder?new Date(t.reminder).toISOString().slice(0,16):'';$('fullDescription').innerHTML=t.desc||'';setSelectedAssignees(t.assigneeIds);
  $('taskFormTitle').innerHTML='<i class="fas fa-tasks"></i> Edit Task';$('saveTaskBtn').innerHTML='<i class="fas fa-save"></i> Update Task';switchPage('assign-task-page','Edit Task');
}
async function deleteTask(id){
  if(!isAdminUser()||!confirm(`Delete task ${id}?`))return;const t=taskList.find(x=>String(x.id)===String(id));if(!t)return;
  const r=await supabaseClient.from('tasks').delete().eq('id',t.dbId);if(r.error)return alert(r.error.message);await loadAllData();
}
async function updateStatus(id,status){
  const t=taskList.find(x=>String(x.id)===String(id));if(!t)return;
  if(!isAdminUser()&&!t.assigneeIds.includes(String(me().id)))return alert('You cannot update this task.');
  const db=status==='In Progress'?'in-progress':status==='Completed'?'completed':status==='Under Review'?'under-review':status==='Cancelled'?'cancelled':'pending';
  const r=await supabaseClient.from('tasks').update({status:db,completed_at:status==='Completed'?new Date().toISOString():null}).eq('id',t.dbId);if(r.error)return alert(r.error.message);
  if(status==='Completed'&&t.createdBy&&String(t.createdBy)!==String(me().id))await supabaseClient.from('notifications').insert({employee_id:t.createdBy,task_id:t.dbId,type:'task',title:'Task Completed',message:`Task completed: ${t.taskType}`,is_read:false});
  await loadAllData();
}

async function saveMember(e){
  e.preventDefault();if(!isAdminUser())return alert('Only Owner/Admin can manage members.');
  const idx=Number($('editMemberIndex').value),name=$('memberName').value.trim(),role=$('memberRole').value.trim(),email=$('memberEmail').value.trim(),phone=$('memberPhone').value.trim();
  if(!name||!role||!email||!phone)return alert('Please fill all member details.');
  try{
    if(idx>=0){
      const m=members[idx],r=await supabaseClient.from('employees').update({name,role,email,phone}).eq('id',m.id);if(r.error)throw r.error;
    }else{
      const loginId=name.split(/\s+/)[0].toLowerCase(),defaultPassword=loginId+'@123',hash=window.bcrypt.hashSync(defaultPassword,10);
      const r=await supabaseClient.from('employees').insert({name,login_id:loginId,password_hash:hash,role:'employee',department:'Other',email,phone,is_active:true});if(r.error)throw r.error;
      alert(`Member added.\nLogin ID: ${loginId}\nDefault password: ${defaultPassword}`);
    }
    $('memberFormTitle').innerHTML='<i class="fas fa-user-plus"></i> Add New Team Member';$('saveMemberBtn').textContent='Save Member';$('editMemberIndex').value='-1';e.target.reset();await loadAllData();
  }catch(err){alert(err.message||err)}
}
function editMember(i){if(!isAdminUser())return;const m=members[i];$('editMemberIndex').value=i;$('memberName').value=m.name||'';$('memberRole').value=m.role||'';$('memberEmail').value=m.email||'';$('memberPhone').value=m.phone||'';$('memberFormTitle').innerHTML='<i class="fas fa-user-edit"></i> Edit Team Member';$('saveMemberBtn').textContent='Update Member'}
async function deleteMember(i){if(!isAdminUser())return;const m=members[i];if(!m||!confirm(`Deactivate ${m.name}?`))return;const r=await supabaseClient.from('employees').update({is_active:false}).eq('id',m.id);if(r.error)return alert(r.error.message);await loadAllData()}
function renderMembers(){
  const b=$('memberTableBody');if(!b)return;b.innerHTML=members.map((m,i)=>`<tr><td><b>${esc(m.name)}</b></td><td>${esc(m.role)}</td><td>${esc(m.email)}</td><td>${esc(m.phone)}</td><td>${taskList.filter(t=>t.assigneeIds.includes(String(m.id))&&t.status==='Completed').length}</td><td><button class="btn-sm btn-edit" onclick="editMember(${i})">Edit</button> <button class="btn-sm btn-delete" onclick="deleteMember(${i})">Deactivate</button></td></tr>`).join('');
}
function renderTeam(){
  const b=$('teamMemberGrid');if(!b)return;
  if(!isAdminUser()){b.innerHTML='';return}
  b.innerHTML=members.map(m=>`<div class="member-tile"><div class="member-photo">${m.profile_photo_url?`<img src="${esc(m.profile_photo_url)}">`:esc(initials(m.name))}</div><h3>${esc(m.name)}</h3><p style="color:var(--primary);font-weight:700">${esc(m.role||'Employee')}</p><p style="font-size:12px;color:var(--text-muted)">${esc(m.department||'Department not added')}</p><p style="font-size:12px;margin-top:6px">${esc(m.email||'')}</p><p style="font-size:12px">${esc(m.phone||'')}</p></div>`).join('');
}

/* ANNOUNCEMENTS */
function announcementCmd(cmd){document.execCommand(cmd,false,null)}
function announcementFontSize(v){if(v)document.execCommand('fontSize',false,v)}
async function createAnnouncement(e){
  e.preventDefault();if(!isAdminUser())return alert('Only Owner/Admin can publish announcements.');
  try{
    const title=$('annTitle').value.trim();if(!title)return alert('Enter an announcement title.');
    const file=await uploadFile($('annFile').files?.[0],'announcements');
    const payload={title,category:$('annCategory').value,description:$('annDescription').innerHTML,published_at:new Date().toISOString(),created_by:me().id,created_by_name:me().name,attachment_url:file?.url||null,attachment_name:file?.name||null,attachment_type:file?.type||null};
    const r=await supabaseClient.from('announcements').insert(payload).select().single();if(r.error)throw r.error;
    const rows=members.filter(m=>String(m.id)!==String(me().id)).map(m=>({employee_id:m.id,type:'announcement',title:'New Announcement',message:title,is_read:false}));
    if(rows.length)await supabaseClient.from('notifications').insert(rows);
    e.target.reset();$('annDescription').innerHTML='';await loadAllData();alert('Announcement published successfully.');
  }catch(err){alert(err.message||err)}
}
function renderAnnouncements(){
  const b=$('announcementList');if(!b)return;
  b.innerHTML=announcements.length?announcements.map(a=>{
    const liked=a.reactions.some(r=>String(r.employee_id)===String(me().id)&&r.reaction==='like'),count=a.reactions.filter(r=>r.reaction==='like').length;
    return `<article class="announcement-card"><div class="announcement-cat">${esc(a.category)}</div><h3 style="margin:5px 0">${esc(a.title)}</h3><small style="color:var(--text-muted)">${esc(fmt(a.published_at))} • ${esc(a.created_by_name||'Owner')}</small><div class="announcement-body">${a.description||''}</div>${a.attachment_url?`<a href="${esc(a.attachment_url)}" target="_blank" rel="noopener" style="color:var(--primary);font-size:12px"><i class="fas fa-paperclip"></i> ${esc(a.attachment_name||'Attachment')}</a>`:''}<div style="margin-top:12px"><button class="reaction-btn" onclick="toggleAnnouncementLike('${esc(a.id)}')">${liked?'❤️':'👍'} Like ${count}</button></div></article>`;
  }).join(''):'<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted)">No announcements yet.</div>';
}
async function toggleAnnouncementLike(id){
  const a=announcements.find(x=>String(x.id)===String(id));if(!a||!me().id)return;
  const existing=a.reactions.find(r=>String(r.employee_id)===String(me().id)&&r.reaction==='like');
  try{
    if(existing)await supabaseClient.from('announcement_reactions').delete().eq('id',existing.id);
    else await supabaseClient.from('announcement_reactions').insert({announcement_id:id,employee_id:me().id,reaction:'like'});
    await loadAllData();
  }catch(e){alert(e.message||e)}
}

/* NOTIFICATIONS */
function renderNotifications(){
  const list=$('notifList'),count=$('notifCount');if(!list||!count)return;
  const unread=notifications.filter(n=>!n.is_read);count.textContent=unread.length;
  list.innerHTML=notifications.length?notifications.slice(0,25).map(n=>`<div class="notif-item" style="${n.is_read?'opacity:.65':'background:#f5f7ff'}" onclick="markNotificationRead('${esc(n.id)}')"><i class="fas ${n.type==='announcement'?'fa-bullhorn':'fa-list-check'}" style="color:${n.type==='announcement'?'#7c3aed':'#2563eb'}"></i> <b>${esc(n.title||'Notification')}</b><div style="font-size:.72rem;margin-top:3px">${esc(n.message||'')}</div><div style="font-size:.65rem;color:var(--text-muted);margin-top:3px">${esc(fmt(n.created_at))}</div></div>`).join(''):'<p style="font-size:.75rem;color:var(--text-muted);text-align:center;padding:10px;">No notifications</p>';
}
async function markNotificationRead(id){const r=await supabaseClient.from('notifications').update({is_read:true}).eq('id',id).eq('employee_id',me().id);if(r.error)return alert(r.error.message);await loadAllData()}
async function markAllNotificationsRead(){const r=await supabaseClient.from('notifications').update({is_read:true}).eq('employee_id',me().id);if(r.error)return alert(r.error.message);await loadAllData()}
function toggleNotificationDropdown(){event?.stopPropagation();$('notifDropdown')?.classList.toggle('show');renderNotifications()}
function requestNotificationPermission(){if('Notification'in window&&Notification.permission==='default')Notification.requestPermission().catch(()=>{})}
function showBrowserNotification(message){if('Notification'in window&&Notification.permission==='granted')try{new Notification('Task Command',{body:message})}catch{}}
function startReminderChecks(){
  if(reminderTimer)clearInterval(reminderTimer);
  reminderTimer=setInterval(async()=>{
    const now=Date.now();
    for(const t of taskList){
      if(!t.reminder||t.status==='Completed'||!t.assigneeIds.includes(String(me().id)))continue;
      const r=new Date(t.reminder).getTime();if(r<=now&&r>now-60000){
        await supabaseClient.from('notifications').insert({employee_id:me().id,task_id:t.dbId,type:'reminder',title:'Task Reminder',message:`Reminder: ${t.taskType} (${t.id})`,is_read:false});
      }
    }
  },60000);
}

/* REPORTS */
function updateReportDates(){
  const p=$('reportPeriod')?.value;if(!p||p==='custom')return;
  const now=new Date(),from=new Date(now);
  if(p==='daily'){}
  else if(p==='weekly'){const day=now.getDay();from.setDate(now.getDate()-(day===0?6:day-1))}
  else if(p==='monthly')from.setDate(1);
  $('reportFrom').value=from.toISOString().slice(0,10);$('reportTo').value=now.toISOString().slice(0,10);
}
function populateReportEmployees(){if($('reportEmployee'))$('reportEmployee').innerHTML='<option value="">All employees</option>'+members.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}
function getReportList(){
  const from=$('reportFrom')?.value||'',to=$('reportTo')?.value||'',emp=isAdminUser()?($('reportEmployee')?.value||''):'';
  return taskList.filter(t=>{const d=(t.createdAt||'').slice(0,10);const dateOk=(!from||d>=from)&&(!to||d<=to);const empOk=!emp||t.assigneeIds.includes(String(emp));const ownOk=isAdminUser()||t.assigneeIds.includes(String(me().id));return dateOk&&empOk&&ownOk});
}
function renderReport(){
  const list=getReportList();window.lastReport=list;
  $('reportTotal').textContent=list.length;$('reportPending').textContent=list.filter(t=>t.status==='Pending').length;$('reportProgress').textContent=list.filter(t=>t.status==='In Progress').length;$('reportCompleted').textContent=list.filter(t=>t.status==='Completed').length;
  $('reportTable').innerHTML=list.map(t=>`<tr><td>${esc(t.id)}</td><td>${esc(t.taskType)}</td><td>${esc(t.assignedTo)}</td><td>${esc(t.status)}</td><td>${esc(t.priority)}</td><td>${esc(t.deadline||'')}</td><td>${esc(fmt(t.createdAt))}</td></tr>`).join('')||'<tr><td colspan="7" style="text-align:center">No report data.</td></tr>';
}
function exportExcel(){
  renderReport();if(!window.XLSX)return alert('Excel library unavailable.');
  const data=(window.lastReport||[]).map(t=>({ID:t.id,Task:t.taskType,AssignedTo:t.assignedTo,Status:t.status,Priority:t.priority,Deadline:t.deadline||'',Created:fmt(t.createdAt)}));
  const ws=XLSX.utils.json_to_sheet(data),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Task Report');XLSX.writeFile(wb,`Task-Report-${new Date().toISOString().slice(0,10)}.xlsx`);
}
function exportPDF(){
  renderReport();const list=window.lastReport||[],w=window.open('','_blank');if(!w)return alert('Please allow popups for PDF export.');
  w.document.write(`<html><head><title>Task Command Report</title><style>body{font-family:Arial;padding:25px}h1{color:#4318ff}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:7px;text-align:left;font-size:11px}</style></head><body><h1>Task Command Report</h1><p>Generated: ${esc(new Date().toLocaleString())}</p><table><tr><th>ID</th><th>Task</th><th>Assigned To</th><th>Status</th><th>Priority</th><th>Deadline</th><th>Created</th></tr>${list.map(t=>`<tr><td>${esc(t.id)}</td><td>${esc(t.taskType)}</td><td>${esc(t.assignedTo)}</td><td>${esc(t.status)}</td><td>${esc(t.priority)}</td><td>${esc(t.deadline||'')}</td><td>${esc(fmt(t.createdAt))}</td></tr>`).join('')}</table><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close();
}

/* REALTIME + UI */
function subscribeRealtime(){
  if(realtimeChannel)supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel=supabaseClient.channel('task-command-live-'+Date.now())
    .on('postgres_changes',{event:'*',schema:'public',table:'tasks'},refreshRealtime)
    .on('postgres_changes',{event:'*',schema:'public',table:'task_assignees'},refreshRealtime)
    .on('postgres_changes',{event:'*',schema:'public',table:'employees'},refreshRealtime)
    .on('postgres_changes',{event:'*',schema:'public',table:'notifications'},async payload=>{await refreshRealtime();const row=payload.new||{};if(String(row.employee_id)===String(me().id)&&row.is_read===false)showBrowserNotification(row.message||row.title||'New notification')})
    .on('postgres_changes',{event:'*',schema:'public',table:'announcements'},refreshRealtime)
    .on('postgres_changes',{event:'*',schema:'public',table:'announcement_reactions'},refreshRealtime)
    .subscribe();
}
async function refreshRealtime(){if(refreshBusy)return;refreshBusy=true;try{await loadAllData()}catch(e){console.error(e)}finally{refreshBusy=false}}
function toggleSidebar(){$('sidebar')?.classList.toggle('open');$('sidebarOverlay')?.classList.toggle('active')}
function execCmd(command,value=null){document.execCommand(command,false,value)}

document.addEventListener('DOMContentLoaded',async()=>{
  const loginPass=$('loginPass');
  if(loginPass) loginPass.value='';
  $('loginPass')?.addEventListener('keydown',e=>{if(e.key==='Enter')handleLogin()});
  try{await loadAllData()}catch(e){console.error(e)}
  if(loggedUser){const u=members.find(x=>norm(x.name)===norm(loggedUser));if(u){loggedEmployee=u;showApp();subscribeRealtime();requestNotificationPermission();startReminderChecks()}}
});
