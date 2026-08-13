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

  const required=rs.slice(0,7).find(r=>r.error);
  if(required)throw required.error;
  const reactionRows=rs[7]?.error?[]:(rs[7].data||[]);
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
  announcements=(rs[6].data||[]).filter(a=>a.is_active!==false).map(a=>({...a,reactions:reactionRows.filter(r=>String(r.announcement_id)===String(a.id))}));
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
  const login=$('loginId')?.value.trim(),password=$('loginPass')?.value||'',err=$('loginError');
  if(!login||!password){err.textContent='Please enter login ID and password.';err.style.display='block';return}
  err.style.display='none';
  try{
    const r=await supabaseClient.rpc('login_employee',{p_login_id:login,p_password:password});
    if(r.error)throw r.error;
    const user=Array.isArray(r.data)?r.data[0]:r.data;
    if(!user)throw new Error('Invalid Name or Password!');
    loggedEmployee=user;loggedUser=user.name;localStorage.setItem(STORAGE.loggedUser,loggedUser);
    await loadAllData();showApp();subscribeRealtime();requestNotificationPermission();startReminderChecks();
  }catch(e){
    console.error(e);
    err.textContent=e.message?.includes('login_employee')?'Run SUPABASE_LOGIN_SQL.sql in Supabase first.':(e.message||'Login failed.');
    err.style.display='block';
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
  if($('fullDepartment'))$('fullDepartment').innerHTML='<option value="" disabled>-- Select Department --</option>'+(departments.map(d=>`<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('')||'<option value="Other">Other</option>');
  if($('memberDepartment'))$('memberDepartment').innerHTML='<option value="" disabled selected>-- Select Department --</option>'+(departments.map(d=>`<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('')||'<option value="Other">Other</option>');
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
    if(file){const ar=await supabaseClient.from('task_attachments').insert({task_id:task.id,file_name:file.name,file_url:file.url,file_type:file.type,file_size:file.size,uploaded_by:me().id});if(ar.error)throw ar.error;}
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
  $('editTaskId').value=t.dbId;$('fullDepartment').value=t.department||'Other';$('fullTaskType').value=t.taskType;$('fullAssignee').value=t.assigneeIds[0]||'';$('fullPriority').value=t.priority;$('fullDeadline').value=t.deadline||'';$('fullReminder').value=t.reminder?new Date(t.reminder).toISOString().slice(0,16):'';$('fullDescription').innerHTML=t.desc||'';setSelectedAssignees(t.assigneeIds);
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
  const idx=Number($('editMemberIndex').value),name=$('memberName').value.trim(),role=$('memberRole').value.trim(),email=$('memberEmail').value.trim(),phone=$('memberPhone').value.trim(),department=$('memberDepartment')?.value||'Other';
  if(!name||!role||!email||!phone||!department)return alert('Please fill all member details.');
  try{
    if(idx>=0){
      const m=members[idx],r=await supabaseClient.from('employees').update({name,role,email,phone,department,updated_at:new Date().toISOString()}).eq('id',m.id);if(r.error)throw r.error;
      alert('Member updated successfully.');
    }else{
      const loginBase=name.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g,'')||'employee';
      let loginId=loginBase, n=1;
      while(members.some(x=>norm(x.login_id)===norm(loginId))) loginId=loginBase+(++n);
      const defaultPassword=loginId+'@123';
      if(!window.bcrypt?.hashSync)throw new Error('Password library is not loaded. Refresh the page and try again.');
      const hash=window.bcrypt.hashSync(defaultPassword,10);
      const r=await supabaseClient.from('employees').insert({name,login_id:loginId,password_hash:hash,role:'employee',department,email,phone,is_active:true}).select('id,name,login_id,role,department,email,phone,is_active').single();
      if(r.error)throw r.error;
      alert(`Member added successfully.\n\nName: ${name}\nEmployee ID: ${loginId}\nPassword: ${defaultPassword}\nDepartment: ${department}`);
    }
    $('memberFormTitle').innerHTML='<i class="fas fa-user-plus"></i> Add New Team Member';$('saveMemberBtn').textContent='Save Member';$('editMemberIndex').value='-1';e.target.reset();await loadAllData();
  }catch(err){console.error('SAVE MEMBER',err);alert(err.message||err)}
}
function editMember(i){if(!isAdminUser())return;const m=members[i];$('editMemberIndex').value=i;$('memberName').value=m.name||'';$('memberRole').value=m.role||'';$('memberEmail').value=m.email||'';$('memberPhone').value=m.phone||'';$('memberDepartment').value=m.department||'Other';$('memberFormTitle').innerHTML='<i class="fas fa-user-edit"></i> Edit Team Member';$('saveMemberBtn').textContent='Update Member'}
async function deleteMember(i){if(!isAdminUser())return;const m=members[i];if(!m||!confirm(`Deactivate ${m.name}?`))return;const r=await supabaseClient.from('employees').update({is_active:false}).eq('id',m.id);if(r.error)return alert(r.error.message);await loadAllData()}
function renderMembers(){
  const b=$('memberTableBody');if(!b)return;b.innerHTML=members.map((m,i)=>`<tr><td><b>${esc(m.name)}</b></td><td>${esc(m.role)}</td><td>${esc(m.email)}</td><td>${esc(m.phone)}</td><td>${esc(m.department||'Other')}</td><td>${taskList.filter(t=>t.assigneeIds.includes(String(m.id))&&t.status==='Completed').length}</td><td><button class="btn-sm btn-edit" onclick="editMember(${i})">Edit</button> <button class="btn-sm btn-delete" onclick="deleteMember(${i})">Deactivate</button></td></tr>`).join('');
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
  e.preventDefault();
  if(!isAdminUser())return alert('Only Owner/Admin can publish announcements.');
  try{
    const title=$('annTitle').value.trim();
    if(!title)return alert('Enter an announcement title.');

    const file=await uploadFile($('annFile').files?.[0],'announcements');
    const payload={
      title,
      announcement_type:$('annCategory').value,
      description:$('annDescription').innerHTML,
      published_at:new Date().toISOString(),
      created_by:me().id,
      attachment_url:file?.url||null,
      attachment_name:file?.name||null,
      is_active:true
    };

    const r=await supabaseClient.from('announcements').insert(payload).select().single();
    if(r.error)throw r.error;

    const rows=members
      .filter(m=>String(m.id)!==String(me().id))
      .map(m=>({
        employee_id:m.id,
        announcement_id:r.data.id,
        type:'announcement',
        title:'New Announcement',
        message:title,
        is_read:false
      }));

    if(rows.length){
      const nr=await supabaseClient.from('notifications').insert(rows);
      if(nr.error)throw nr.error;
    }

    e.target.reset();
    $('annDescription').innerHTML='';
    await loadAllData();
    alert('Announcement published successfully.');
  }catch(err){
    console.error(err);
    alert(err.message||err);
  }
}
function renderAnnouncements(){
  const b=$('announcementList');
  if(!b)return;
  const byId=Object.fromEntries(members.map(m=>[String(m.id),m]));

  b.innerHTML=announcements.length
    ? announcements.map(a=>{
        const reactions=Array.isArray(a.reactions)?a.reactions:[];
        const liked=reactions.some(r=>String(r.employee_id)===String(me().id)&&r.reaction==='like');
        const count=reactions.filter(r=>r.reaction==='like').length;
        const creator=byId[String(a.created_by)]?.name||'Owner';
        const when=a.published_at||a.created_at;

        return `<article class="announcement-card">
          <div class="announcement-cat">${esc(a.announcement_type||'General')}</div>
          <h3 style="margin:5px 0">${esc(a.title)}</h3>
          <small style="color:var(--text-muted)">${esc(fmt(when))} • ${esc(creator)}</small>
          <div class="announcement-body">${a.description||''}</div>
          ${a.attachment_url?`<a href="${esc(a.attachment_url)}" target="_blank" rel="noopener" style="color:var(--primary);font-size:12px"><i class="fas fa-paperclip"></i> ${esc(a.attachment_name||'Attachment')}</a>`:''}
          <div style="margin-top:12px">
            <button class="reaction-btn" onclick="toggleAnnouncementLike('${esc(a.id)}')">${liked?'❤️':'👍'} Like ${count}</button>
          </div>
        </article>`;
      }).join('')
    : '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted)">No announcements yet.</div>';
}
async function toggleAnnouncementLike(id){
  const a=announcements.find(x=>String(x.id)===String(id));
  if(!a||!me().id)return;

  const reactions=Array.isArray(a.reactions)?a.reactions:[];
  const existing=reactions.find(r=>String(r.employee_id)===String(me().id)&&r.reaction==='like');

  try{
    if(existing){
      const r=await supabaseClient.from('announcement_reactions').delete().eq('id',existing.id);
      if(r.error)throw r.error;
    }else{
      const r=await supabaseClient.from('announcement_reactions').insert({
        announcement_id:id,
        employee_id:me().id,
        reaction:'like'
      });
      if(r.error)throw r.error;
    }
    await loadAllData();
  }catch(e){
    alert(e.message||e);
  }
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

function clearLoginPassword(){
  const p=$('loginPass');
  if(p){
    p.value='';
    p.setAttribute('autocomplete','new-password');
  }
}
document.addEventListener('DOMContentLoaded',async()=>{
  clearLoginPassword();
  window.setTimeout(clearLoginPassword,100);
  window.setTimeout(clearLoginPassword,500);
  $('loginForm')?.addEventListener('submit',e=>{e.preventDefault();handleLogin()});
  $('loginPass')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();handleLogin()}});
  try{await loadAllData()}catch(e){console.error(e)}
  if(loggedUser){
    const u=members.find(x=>norm(x.name)===norm(loggedUser)||norm(x.login_id)===norm(loggedUser));
    if(u){loggedEmployee=u;showApp();subscribeRealtime();requestNotificationPermission();startReminderChecks()}
  }
});

/* TASK COMMAND - PRESERVE EXISTING APP + ADD CHAT ONLY */
var APP = window.APP || {};
Object.defineProperty(APP,'currentUser',{get:function(){return loggedEmployee;},configurable:true});
Object.defineProperty(APP,'sessionToken',{get:function(){return localStorage.getItem('taskCommandSession')||'';},configurable:true});
window.APP=APP;
function getSessionToken(){return localStorage.getItem('taskCommandSession')||'';}
function sbError(error){return new Error(error?.message||error?.error_description||'Supabase request failed.');}
function toast(msg){let t=document.getElementById('toast');if(!t){t=document.createElement('div');t.id='toast';t.style.cssText='position:fixed;right:22px;bottom:22px;z-index:100001;background:#102b67;color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.2);display:none;font-weight:700;max-width:360px';document.body.appendChild(t)}t.textContent=msg;t.style.display='block';clearTimeout(window.__tcToast);window.__tcToast=setTimeout(()=>t.style.display='none',2800)}
function escapeHtml(v){return esc(v);}

/* =========================================================
   TASK COMMAND - LIVE CHAT / WHATSAPP STYLE MODULE
   ========================================================= */
(function(){
'use strict';

const CHAT={conversations:[],activeId:null,messages:[],lastPoll:null,pollTimer:null,searchTimer:null,channel:null,unread:0};
window.TC_CHAT=CHAT;

function cEsc(v){return escapeHtml(v==null?'':String(v));}
function chatCall(name,args){return supabaseClient.rpc(name,args).then(r=>{if(r.error)throw sbError(r.error);return r.data||{};});}
function chatMeId(){return APP.currentUser?.id||APP.currentUser?.employee_id||'';}
function chatLogin(){return APP.currentUser?.employeeId||APP.currentUser?.login_id||APP.currentUser?.name||'';}
function chatTime(v){if(!v)return '';const d=new Date(v);return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}
function chatDate(v){if(!v)return '';const d=new Date(v);return d.toLocaleDateString([], {day:'2-digit',month:'short'});}
function chatAvatar(name,photo){return photo?`<img src="${cEsc(photo)}" alt="">`:cEsc(initials(name));}

function injectChatUI(){
  if(document.getElementById('tcChatPage'))return;
  const css=document.createElement('style');css.id='tcChatCss';css.textContent=`
  #tcChatPage{position:absolute;inset:0;display:none;background:#f4f7fc;z-index:20;padding:18px;box-sizing:border-box}
  #tcChatPage.tc-chat-active{display:block}
  .tc-chat-shell{height:calc(100vh - 36px);min-height:560px;display:grid;grid-template-columns:330px 1fr;background:#fff;border:1px solid #dbe5f5;border-radius:22px;overflow:hidden;box-shadow:0 20px 55px rgba(20,45,100,.12)}
  .tc-chat-sidebar{background:linear-gradient(180deg,#071d55,#0b2b72);color:#fff;display:flex;flex-direction:column;min-width:0}
  .tc-chat-brand{padding:20px 18px 12px;font-weight:900;font-size:19px;display:flex;align-items:center;gap:10px}.tc-chat-brand i{background:linear-gradient(135deg,#2196ff,#5140ff);width:38px;height:38px;border-radius:12px;display:grid;place-items:center}
  .tc-chat-search{padding:8px 14px 14px}.tc-chat-search input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.11);border:1px solid rgba(255,255,255,.18);color:#fff;border-radius:12px;padding:11px 12px;outline:none}.tc-chat-search input::placeholder{color:#b9c7e8}
  .tc-chat-list{overflow:auto;flex:1;padding:4px 8px}.tc-chat-item{display:flex;gap:10px;padding:11px 10px;border-radius:14px;cursor:pointer;align-items:center}.tc-chat-item:hover,.tc-chat-item.active{background:rgba(255,255,255,.12)}
  .tc-chat-avatar{width:43px;height:43px;border-radius:50%;background:#2f6eff;display:grid;place-items:center;overflow:hidden;flex:0 0 43px;font-weight:900}.tc-chat-avatar img{width:100%;height:100%;object-fit:cover}.tc-chat-meta{min-width:0;flex:1}.tc-chat-meta-top{display:flex;justify-content:space-between;gap:8px}.tc-chat-name{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tc-chat-time{font-size:10px;color:#b8c6e6;white-space:nowrap}.tc-chat-preview{font-size:12px;color:#c1cce5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}.tc-chat-badge{background:#35d17d;color:#082b1a;border-radius:999px;min-width:20px;height:20px;padding:0 6px;display:grid;place-items:center;font-size:10px;font-weight:900}
  .tc-chat-main{display:flex;flex-direction:column;min-width:0;background:#f8faff}.tc-chat-head{height:74px;background:#fff;border-bottom:1px solid #e3eaf5;display:flex;align-items:center;justify-content:space-between;padding:0 20px}.tc-chat-head-user{display:flex;align-items:center;gap:11px}.tc-chat-head h3{margin:0;color:#0b1f49;font-size:16px}.tc-chat-head small{color:#7b8aa7}.tc-chat-actions button,.tc-chat-new{border:0;background:#edf3ff;color:#173b8f;border-radius:10px;padding:9px 11px;cursor:pointer;font-weight:800}.tc-chat-actions{display:flex;gap:8px}
  .tc-chat-messages{flex:1;overflow:auto;padding:24px 6%;background:radial-gradient(circle at 20% 20%,rgba(41,120,255,.04),transparent 28%),#f8faff}.tc-chat-empty{text-align:center;color:#8190ad;margin-top:20vh}.tc-bubble-row{display:flex;margin:8px 0}.tc-bubble-row.mine{justify-content:flex-end}.tc-bubble{max-width:min(68%,650px);padding:9px 12px;border-radius:15px;background:#fff;border:1px solid #e2e9f4;box-shadow:0 3px 12px rgba(22,52,110,.05);color:#17233d}.tc-bubble-row.mine .tc-bubble{background:linear-gradient(135deg,#dcecff,#e8e4ff);border-color:#c8d9ff}.tc-bubble-sender{font-size:10px;color:#3b63a8;font-weight:900;margin-bottom:4px}.tc-bubble-text{white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.45}.tc-bubble-time{font-size:9px;color:#8794aa;text-align:right;margin-top:4px}.tc-bubble-file{display:flex;align-items:center;gap:8px;padding:8px;background:#f3f7ff;border-radius:10px;text-decoration:none;color:#173b8f;font-weight:800;font-size:12px}
  .tc-chat-compose{background:#fff;border-top:1px solid #e3eaf5;padding:10px 14px;display:flex;gap:8px;align-items:center}.tc-chat-compose textarea{flex:1;resize:none;border:1px solid #d9e3f3;border-radius:13px;padding:11px 13px;min-height:42px;max-height:120px;outline:none}.tc-chat-compose button{width:42px;height:42px;border:0;border-radius:12px;background:#eef4ff;color:#173b8f;cursor:pointer}.tc-chat-send{background:linear-gradient(135deg,#168cff,#4a3cff)!important;color:#fff!important}.tc-emoji-menu{position:absolute;bottom:65px;left:14px;background:#fff;border:1px solid #dbe4f2;box-shadow:0 15px 35px rgba(0,0,0,.12);border-radius:14px;padding:8px;display:none;grid-template-columns:repeat(8,30px);gap:4px;z-index:5}.tc-emoji-menu button{background:#fff!important;color:#222!important;font-size:20px!important;width:30px!important;height:30px!important}.tc-chat-compose-wrap{position:relative;display:flex;gap:8px;flex:1}.tc-chat-compose-wrap textarea{width:100%}
  .tc-chat-modal{position:fixed;inset:0;background:rgba(7,20,52,.45);display:none;align-items:center;justify-content:center;z-index:10050}.tc-chat-modal.open{display:flex}.tc-chat-dialog{width:min(560px,94vw);background:#fff;border-radius:18px;padding:20px;box-shadow:0 30px 80px rgba(0,0,0,.25)}.tc-chat-dialog h3{margin:0 0 14px;color:#102a62}.tc-chat-people{max-height:300px;overflow:auto;border:1px solid #e3eaf5;border-radius:12px}.tc-chat-person{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #eef2f8}.tc-chat-person:last-child{border-bottom:0}.tc-chat-person input{accent-color:#3f37ff}.tc-chat-dialog input[type=text]{width:100%;box-sizing:border-box;padding:11px;border:1px solid #dbe4f2;border-radius:10px;margin-bottom:12px}.tc-chat-dialog-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}.tc-chat-dialog-footer button{border:0;border-radius:10px;padding:10px 15px;font-weight:800;cursor:pointer}.tc-chat-primary{background:linear-gradient(135deg,#168cff,#4a3cff);color:#fff}.tc-chat-secondary{background:#eef3fa;color:#173b8f}
  .tc-chat-drop{font-size:10px;color:#7d8da8;margin-left:4px}.tc-chat-mobile-back{display:none}
  @media(max-width:800px){.tc-chat-shell{grid-template-columns:1fr}.tc-chat-sidebar{display:none}.tc-chat-shell.list-open .tc-chat-sidebar{display:flex}.tc-chat-shell.list-open .tc-chat-main{display:none}.tc-chat-mobile-back{display:inline-block}.tc-bubble{max-width:82%}}
  `;document.head.appendChild(css);
  const page=document.createElement('div');page.id='tcChatPage';page.className='modal-page';page.innerHTML=`
    <div class="tc-chat-shell" id="tcChatShell">
      <aside class="tc-chat-sidebar">
        <div class="tc-chat-brand"><i class="fas fa-comments"></i><span>Team Chat</span><button class="tc-chat-new" onclick="TC_CHAT_UI.openNew()" title="New chat" style="margin-left:auto">＋</button></div>
        <div class="tc-chat-search"><input id="tcChatSearch" placeholder="Search people or chats..." oninput="TC_CHAT_UI.search(this.value)"></div>
        <div class="tc-chat-list" id="tcChatList"></div>
      </aside>
      <main class="tc-chat-main">
        <header class="tc-chat-head"><div class="tc-chat-head-user"><button class="tc-chat-actions tc-chat-mobile-back" onclick="TC_CHAT_UI.mobileBack()">‹</button><div class="tc-chat-avatar" id="tcChatHeadAvatar">C</div><div><h3 id="tcChatHeadName">Select a chat</h3><small id="tcChatHeadSub">Your team conversation</small></div></div><div class="tc-chat-actions"><button onclick="TC_CHAT_UI.openNew()"><i class="fas fa-user-plus"></i></button><button onclick="TC_CHAT_UI.refresh()"><i class="fas fa-rotate"></i></button></div></header>
        <section class="tc-chat-messages" id="tcChatMessages"><div class="tc-chat-empty"><i class="fas fa-comments" style="font-size:42px;color:#9db4df"></i><h3>Team Chat</h3><p>Start a conversation with your team.</p></div></section>
        <div class="tc-chat-compose" id="tcChatCompose" style="display:none"><div class="tc-chat-compose-wrap"><div class="tc-emoji-menu" id="tcEmojiMenu"></div><button onclick="TC_CHAT_UI.toggleEmoji()">😊</button><textarea id="tcChatInput" placeholder="Type a message..." onkeydown="TC_CHAT_UI.key(event)"></textarea></div><input id="tcChatFile" type="file" hidden onchange="TC_CHAT_UI.attach(this)"><button onclick="document.getElementById('tcChatFile').click()"><i class="fas fa-paperclip"></i></button><button class="tc-chat-send" onclick="TC_CHAT_UI.send()"><i class="fas fa-paper-plane"></i></button></div>
      </main>
    </div>`;
  document.querySelector('main')?.appendChild(page) || document.body.appendChild(page);

  const modal=document.createElement('div');modal.id='tcChatModal';modal.className='tc-chat-modal';modal.innerHTML=`<div class="tc-chat-dialog"><h3>New Chat</h3><div style="display:flex;gap:8px;margin-bottom:12px"><button class="tc-chat-primary" onclick="TC_CHAT_UI.openDirectMode()">Direct Chat</button><button class="tc-chat-secondary" onclick="TC_CHAT_UI.openGroupMode()">Create Group</button></div><div id="tcChatDialogBody"></div><div class="tc-chat-dialog-footer"><button class="tc-chat-secondary" onclick="TC_CHAT_UI.closeModal()">Cancel</button><button class="tc-chat-primary" onclick="TC_CHAT_UI.create()">Create / Open</button></div></div>`;document.body.appendChild(modal);
  buildEmoji();
}

function buildEmoji(){const m=document.getElementById('tcEmojiMenu');if(!m)return;['😀','😂','😍','👍','👏','🙏','🔥','🎉','❤️','😊','😎','🤝','💯','✅','❌','📌','🚀','💡','👀','🙌','😄','😢','😡','🎯'].forEach(e=>{const b=document.createElement('button');b.textContent=e;b.onclick=()=>{const i=document.getElementById('tcChatInput');i.value+=(i.value?' ':'')+e;i.focus();m.style.display='none'};m.appendChild(b)});}

async function loadConversations(){if(!chatLogin())return;try{const r=await chatCall('chat_list_conversations',{p_employee_id:chatLogin(),p_session_token:getSessionToken()});if(r.ok===false)throw new Error(r.message||'Chat unavailable');CHAT.conversations=r.conversations||[];CHAT.unread=CHAT.conversations.reduce((n,c)=>n+Number(c.unread||0),0);renderConversationList();updateChatBadge();}catch(e){console.warn('CHAT LIST',e);renderConversationList(e.message);}}
function renderConversationList(err){const el=document.getElementById('tcChatList');if(!el)return;if(err&&!CHAT.conversations.length){el.innerHTML=`<div style="padding:20px;color:#ffd0d0;font-size:12px">${cEsc(err)}<br><small>Run CHAT_SCHEMA.sql in Supabase.</small></div>`;return}el.innerHTML=CHAT.conversations.map(c=>`<div class="tc-chat-item ${c.id===CHAT.activeId?'active':''}" onclick="TC_CHAT_UI.open('${c.id}')"><div class="tc-chat-avatar">${chatAvatar(c.name,c.photo)}</div><div class="tc-chat-meta"><div class="tc-chat-meta-top"><span class="tc-chat-name">${cEsc(c.name||'Chat')}</span><span class="tc-chat-time">${c.lastAt?chatTime(c.lastAt):''}</span></div><div class="tc-chat-preview">${cEsc(c.lastMessage||'Start chatting')}</div></div>${Number(c.unread)>0?`<span class="tc-chat-badge">${Number(c.unread)>99?'99+':c.unread}</span>`:''}</div>`).join('')||'<div style="padding:22px;color:#c1cce5;text-align:center">No chats yet.<br>Tap ＋ to start one.</div>';}
function updateChatBadge(){const items=document.querySelectorAll('[data-tc-chat-badge]');items.forEach(x=>{x.textContent=CHAT.unread?String(CHAT.unread):'';x.style.display=CHAT.unread?'inline-grid':'none'});}

async function openConversation(id){CHAT.activeId=id;const c=CHAT.conversations.find(x=>x.id===id);document.getElementById('tcChatHeadName').textContent=c?.name||'Chat';document.getElementById('tcChatHeadSub').textContent=c?.kind==='group'?'Group conversation':'Team member';document.getElementById('tcChatHeadAvatar').innerHTML=chatAvatar(c?.name||'C',c?.photo);document.getElementById('tcChatCompose').style.display='flex';document.getElementById('tcChatShell').classList.remove('list-open');try{const r=await chatCall('chat_get_messages',{p_employee_id:chatLogin(),p_conversation_id:id,p_session_token:getSessionToken()});if(r.ok===false)throw new Error(r.message);CHAT.messages=r.messages||[];renderMessages();await chatCall('chat_mark_read',{p_employee_id:chatLogin(),p_conversation_id:id,p_session_token:getSessionToken()});const c2=CHAT.conversations.find(x=>x.id===id);if(c2)c2.unread=0;CHAT.unread=CHAT.conversations.reduce((n,x)=>n+Number(x.unread||0),0);renderConversationList();updateChatBadge();}catch(e){toast('Chat load failed: '+(e.message||e));}}
function renderMessages(){const el=document.getElementById('tcChatMessages');if(!el)return;if(!CHAT.messages.length){el.innerHTML='<div class="tc-chat-empty"><i class="fas fa-message" style="font-size:38px;color:#9db4df"></i><p>No messages yet. Say hello 👋</p></div>';return}el.innerHTML=CHAT.messages.map(m=>{const mine=String(m.senderId)===String(chatMeId());const deleted=!!m.deletedAt;return `<div class="tc-bubble-row ${mine?'mine':''}"><div class="tc-bubble">${!mine&&CHAT.conversations.find(c=>c.id===CHAT.activeId)?.kind==='group'?`<div class="tc-bubble-sender">${cEsc(m.senderName)}</div>`:''}${deleted?'<div style="font-style:italic;color:#8b96aa">Message deleted</div>':`${m.body?`<div class="tc-bubble-text">${cEsc(m.body)}</div>`:''}${m.attachmentUrl?`<a class="tc-bubble-file" href="${cEsc(m.attachmentUrl)}" target="_blank" rel="noopener"><i class="fas fa-paperclip"></i>${cEsc(m.attachmentName||'Attachment')}</a>`:''}`}<div class="tc-bubble-time">${chatTime(m.createdAt)}${m.editedAt?' · edited':''}${mine?' ✓':''}</div></div></div>`}).join('');el.scrollTop=el.scrollHeight;}

async function sendMessage(){if(!CHAT.activeId)return;const input=document.getElementById('tcChatInput'),text=input.value.trim();const file=document.getElementById('tcChatFile').files[0];if(!text&&!file)return;try{let url=null,name=null,type='text';if(file){if(file.size>10*1024*1024)throw new Error('File must be 10 MB or smaller.');const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');const path=`${chatLogin()}/${Date.now()}-${safe}`;const up=await supabaseClient.storage.from('chat-attachments').upload(path,file,{upsert:false,contentType:file.type||undefined});if(up.error)throw sbError(up.error);url=supabaseClient.storage.from('chat-attachments').getPublicUrl(path).data.publicUrl;name=file.name;type=file.type?.startsWith('image/')?'image':'file';}const r=await chatCall('chat_send_message',{p_employee_id:chatLogin(),p_conversation_id:CHAT.activeId,p_body:text,p_message_type:type,p_attachment_url:url,p_attachment_name:name,p_reply_to:null,p_session_token:getSessionToken()});if(r.ok===false)throw new Error(r.message);input.value='';document.getElementById('tcChatFile').value='';CHAT.messages.push(r.message);renderMessages();await loadConversations();}catch(e){toast('Message failed: '+(e.message||e));}}

async function createOrOpen(){const mode=TC_CHAT_UI.mode||'direct';const selected=[...document.querySelectorAll('#tcChatPeople input:checked')].map(x=>x.value);try{let r;if(mode==='direct'){if(selected.length!==1)throw new Error('Select one team member.');r=await chatCall('chat_open_direct',{p_employee_id:chatLogin(),p_other_employee_id:selected[0],p_session_token:getSessionToken()});}else{const name=document.getElementById('tcChatGroupName').value.trim();if(!name)throw new Error('Enter group name.');if(!selected.length)throw new Error('Select at least one member.');r=await chatCall('chat_create_group',{p_employee_id:chatLogin(),p_name:name,p_member_ids:selected,p_session_token:getSessionToken()});}if(r.ok===false)throw new Error(r.message);closeModal();await loadConversations();await openConversation(r.conversationId);}catch(e){toast(e.message||String(e));}}
async function openNewModal(){TC_CHAT_UI.mode='direct';document.getElementById('tcChatModal').classList.add('open');renderPeopleDialog();}
async function renderPeopleDialog(q=''){const body=document.getElementById('tcChatDialogBody');body.innerHTML='<div style="padding:20px;text-align:center;color:#8291aa">Loading...</div>';const r=await chatCall('chat_search_people',{p_employee_id:chatLogin(),p_query:q});const people=r.people||[];body.innerHTML=`${TC_CHAT_UI.mode==='group'?'<input id="tcChatGroupName" type="text" placeholder="Group name">':''}<div class="tc-chat-people" id="tcChatPeople">${people.map(p=>`<label class="tc-chat-person"><input type="checkbox" value="${cEsc(p.id)}"><div class="tc-chat-avatar" style="width:34px;height:34px;flex-basis:34px">${chatAvatar(p.name,p.photo)}</div><div><b>${cEsc(p.name)}</b><div style="font-size:11px;color:#8190ad">${cEsc(p.department||p.role||'Team member')}</div></div></label>`).join('')||'<div style="padding:20px;color:#8190ad">No team members found.</div>'}</div>`;}
function switchChatMode(mode){TC_CHAT_UI.mode=mode;renderPeopleDialog();}
function searchPeople(q){clearTimeout(CHAT.searchTimer);CHAT.searchTimer=setTimeout(()=>{if(document.getElementById('tcChatModal').classList.contains('open'))renderPeopleDialog(q);else filterChats(q)},250);}
function filterChats(q){q=String(q||'').toLowerCase();document.querySelectorAll('.tc-chat-item').forEach(x=>x.style.display=x.textContent.toLowerCase().includes(q)?'flex':'none');}
async function poll(){if(!APP.currentUser)return;try{const r=await chatCall('chat_poll',{p_employee_id:chatLogin(),p_since:CHAT.lastPoll,p_session_token:getSessionToken()});CHAT.lastPoll=new Date().toISOString();const msgs=r.messages||[];for(const m of msgs){if(!CHAT.activeId||m.conversationId!==CHAT.activeId){notifyChat(m);}else{CHAT.messages.push(m);renderMessages();await chatCall('chat_mark_read',{p_employee_id:chatLogin(),p_conversation_id:m.conversationId,p_session_token:getSessionToken()});}}if(msgs.length)await loadConversations();}catch(e){console.warn('CHAT POLL',e);}}
function notifyChat(m){const title=m.senderName||'New message';const body=m.body||'Sent an attachment';try{toast(`${title}: ${body}`);}catch(_){}if('Notification' in window){if(Notification.permission==='granted')new Notification(title,{body,icon:APP.currentUser?.profile_photo_url||undefined,tag:'task-command-chat'});}}
function startPolling(){clearInterval(CHAT.pollTimer);CHAT.lastPoll=new Date().toISOString();CHAT.pollTimer=setInterval(poll,2500);}
function requestChatNotifications(){if('Notification' in window&&Notification.permission==='default')Notification.requestPermission().catch(()=>{});}

const TC_CHAT_UI={
  open:openConversation,refresh:loadConversations,mobileBack:()=>document.getElementById('tcChatShell').classList.add('list-open'),
  search:searchPeople,key:e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}},send:sendMessage,attach:f=>{if(f.files[0])toast('Attachment ready: '+f.files[0].name);},toggleEmoji:()=>{const x=document.getElementById('tcEmojiMenu');x.style.display=x.style.display==='grid'?'none':'grid'},openNew:openNewModal,closeModal:()=>document.getElementById('tcChatModal').classList.remove('open'),openDirectMode:()=>switchChatMode('direct'),openGroupMode:()=>switchChatMode('group'),create:createOrOpen,mode:'direct'
};
window.TC_CHAT_UI=TC_CHAT_UI;

function addChatNav(){const nav=[...document.querySelectorAll('.nav-item')].find(x=>/Announcements/i.test(x.textContent||''));if(!nav||document.getElementById('tcChatNav'))return;const li=document.createElement('li');li.id='tcChatNav';li.className='nav-item';li.innerHTML='<i class="fas fa-comments"></i> Team Chat <span data-tc-chat-badge class="tc-chat-badge" style="display:none;margin-left:auto;background:#35d17d"></span>';li.onclick=function(){openChatPage(li)};nav.parentNode.insertBefore(li,nav.nextSibling);}
async function openChatPage(el){injectChatUI();document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));el?.classList.add('active');document.querySelectorAll('.modal-page').forEach(x=>x.classList.remove('active'));document.getElementById('tcChatPage').classList.add('tc-chat-active');requestChatNotifications();await loadConversations();startPolling();}
window.openTaskCommandChat=openChatPage;

function bootChat(){injectChatUI();addChatNav();if(APP.currentUser){startPolling();}}
window.addEventListener('load',()=>setTimeout(bootChat,700));
const oldShowPage=window.showPage;
window.showPage=function(id){if(id!=='tcChatPage'){document.getElementById('tcChatPage')?.classList.remove('tc-chat-active');}if(oldShowPage)oldShowPage.apply(this,arguments);};
const oldLoadData=window.loadData;
if(typeof oldLoadData==='function')window.loadData=async function(){const r=await oldLoadData.apply(this,arguments);try{addChatNav();if(document.getElementById('tcChatPage')?.classList.contains('tc-chat-active'))loadConversations();}catch(_){}return r;};

})();
