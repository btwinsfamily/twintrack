import {createClient} from '@supabase/supabase-js';
import Chart from 'chart.js/auto';
import './style.css';

const url=import.meta.env.VITE_SUPABASE_URL, key=import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase=url&&key?createClient(url,key,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}}):null;
const app=document.getElementById('app');
const state={session:null,family:null,members:[],babies:[],baby:'all',activities:[],growth:[],tab:'today',chart:null,channel:null};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=t=>new Date(t).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const day=t=>new Date(t).toLocaleDateString('en-CA');
const today=()=>day(Date.now());
const isoLocal=(d=new Date())=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
const error=e=>{console.error(e);alert(e?.message||String(e));};
const msg=t=>{const el=document.querySelector('#status');if(el){el.textContent=t;setTimeout(()=>{if(el.textContent===t)el.textContent='';},4000)}};
const inviteToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
async function sha256(s){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}
function authView(){app.innerHTML=`<main class="auth"><div class="brand-icon">♥ ♥</div><h1>Little Days</h1><p class="muted">A calmer way to care, together.</p><section class="panel"><h2>Family sign in</h2><form id="auth-form"><label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" required></label><div class="actions"><button type="submit" name="action" value="signin">Sign in</button><button type="submit" class="secondary" name="action" value="signup">Create account</button></div></form><p class="muted small">Email confirmation may be required. Use the same email address as your family invitation.</p></section></main>`;
 document.querySelector('#auth-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target), action=e.submitter?.value||'signin',email=f.get('email'),password=f.get('password');try{const {error:err}=action==='signup'?await supabase.auth.signUp({email,password}):await supabase.auth.signInWithPassword({email,password});if(err)throw err;if(action==='signup')alert('Account created. If email confirmation is enabled, check your inbox before signing in.');}catch(ex){error(ex)}};
}

function setupView() {
  app.innerHTML = `
    <main class="auth">
      <div class="brand-icon">♥ ♥</div>
      <h1>Welcome to TwinTrack</h1>
      <p class="muted">
        Create your private family workspace.
      </p>

      <section class="panel">
        <h2>Set up your family</h2>

        <form id="setup">
          <label>
            Family name
            <input name="name" required maxlength="80"
                   placeholder="Our family">
          </label>

          <label>
            First baby’s name
            <input name="a" required maxlength="80"
                   placeholder="Baby A">
          </label>

          <label>
            Second baby’s name
            <input name="b" required maxlength="80"
                   placeholder="Baby B">
          </label>

          <button type="submit">
            Create family
          </button>
        </form>
      </section>

      <button class="link" id="logout">
        Sign out
      </button>
    </main>
  `;

  document.querySelector('#logout').onclick =
    () => supabase.auth.signOut();

  document.querySelector('#setup').onsubmit =
    async (e) => {
      e.preventDefault();

      const form = e.target;
      const button = form.querySelector(
        'button[type="submit"]'
      );

      const f = new FormData(form);

      button.disabled = true;
      button.textContent = 'Creating family...';

      try {
        const { data, error: err } =
          await supabase.rpc(
            'create_family_with_twins',
            {
              family_name:
                String(f.get('name')).trim(),
              baby_a_name:
                String(f.get('a')).trim(),
              baby_b_name:
                String(f.get('b')).trim()
            }
          );

        if (err) throw err;

        console.log('Family created:', data);

        await load();

      } catch (ex) {
        error(ex);
      } finally {
        button.disabled = false;
        button.textContent = 'Create family';
      }
    };
}
async function load(){if(!state.session)return authView();try{
 const {data:members,error:me}=await supabase.from('family_members').select('family_id,role').eq('user_id',state.session.user.id);if(me)throw me;
 if(!members?.length){const token=new URLSearchParams(location.hash.slice(1)).get('invite');if(token){const {error:ie}=await supabase.rpc('redeem_family_invite',{invite_token:token});if(ie){error(ie);return setupView()}history.replaceState({},'',location.pathname+location.search);return load()}return setupView()}
 const fid=state.family&&members.some(m=>m.family_id===state.family.id)?state.family.id:members[0].family_id;
 const [fr,br,ar,gr]=await Promise.all([supabase.from('families').select('*').eq('id',fid).single(),supabase.from('babies').select('*').eq('family_id',fid).order('created_at'),supabase.from('activities').select('*').eq('family_id',fid).gte('started_at',new Date(Date.now()-45*86400000).toISOString()).order('started_at',{ascending:false}).limit(2000),supabase.from('growth').select('*').eq('family_id',fid).order('measured_at',{ascending:false}).limit(500)]);
 for(const r of [fr,br,ar,gr])if(r.error)throw r.error;
 Object.assign(state,{family:fr.data,members,babies:br.data,activities:ar.data,growth:gr.data});
 subscribe(fid);render();
 }catch(ex){error(ex);app.innerHTML='<main class="auth"><h2>Could not load family data</h2><button id="retry">Retry</button></main>';document.querySelector('#retry').onclick=load;}}
function subscribe(fid){if(state.channel){supabase.removeChannel(state.channel);state.channel=null;}state.channel=supabase.channel('family-'+fid).on('postgres_changes',{event:'*',schema:'public',table:'activities',filter:`family_id=eq.${fid}`},()=>refreshData()).on('postgres_changes',{event:'*',schema:'public',table:'growth',filter:`family_id=eq.${fid}`},()=>refreshData()).subscribe();}
let refreshing=false;
async function refreshData(){if(refreshing)return;refreshing=true;try{const [a,g]=await Promise.all([supabase.from('activities').select('*').eq('family_id',state.family.id).gte('started_at',new Date(Date.now()-45*86400000).toISOString()).order('started_at',{ascending:false}).limit(2000),supabase.from('growth').select('*').eq('family_id',state.family.id).order('measured_at',{ascending:false}).limit(500)]);if(a.error||g.error)throw a.error||g.error;state.activities=a.data;state.growth=g.data;render()}catch(e){console.error(e)}finally{refreshing=false}}
function currentBabies(){return state.baby==='all'?state.babies:state.babies.filter(b=>b.id===state.baby)}
function records(){const ids=new Set(currentBabies().map(b=>b.id));return state.activities.filter(a=>ids.has(a.baby_id));}
function todayRecords(){return records().filter(a=>day(a.started_at)===today());}
function nameOf(id){return state.babies.find(b=>b.id===id)?.name||'Baby'}
function icon(k){return ({feed:'🍼',diaper:'🧷',sleep:'🌙',medicine:'💊',note:'📝'})[k]||'•'}
function describe(a){const d=a.details||{};if(a.kind==='feed')return [d.method,d.volume_ml?`${d.volume_ml} ml`:'',d.duration_min?`${d.duration_min} min`:''].filter(Boolean).join(' · ');if(a.kind==='diaper')return d.type||'Changed';if(a.kind==='sleep')return a.ended_at?`${Math.round((new Date(a.ended_at)-new Date(a.started_at))/60000)} min`:'Sleeping now';return d.text||d.name||'';}
function render(){if(state.chart){state.chart.destroy();state.chart=null}const babies=state.babies,ts=todayRecords();const feeds=ts.filter(a=>a.kind==='feed'),diapers=ts.filter(a=>a.kind==='diaper'),sleep=ts.filter(a=>a.kind==='sleep');const milk=feeds.reduce((n,a)=>n+(Number(a.details?.volume_ml)||0),0);const sleepMin=sleep.reduce((n,a)=>n+Math.max(0,((new Date(a.ended_at||Date.now()))-new Date(a.started_at))/60000),0);
 app.innerHTML=`<div class="shell"><header class="top"><div><div class="eyebrow">FAMILY CARE TRACKER</div><h1>Little Days <span class="hearts">♥ ♥</span></h1><p class="muted">${esc(state.family.name)}</p></div><button class="secondary compact" id="logout">Sign out</button></header><nav class="tabs" aria-label="Sections">${[['today','Today'],['log','Quick log'],['trends','Trends'],['growth','Growth'],['family','Family']].map(([id,n])=>`<button data-tab="${id}" class="${state.tab===id?'active':''}">${n}</button>`).join('')}</nav><div class="baby-select"><button data-baby="all" class="${state.baby==='all'?'selected':''}">Both twins</button>${babies.map((b,i)=>`<button data-baby="${b.id}" class="${state.baby===b.id?'selected':''}">${i===0?'🩵':'🧡'} ${esc(b.name)}</button>`).join('')}</div><div id="status" role="status" aria-live="polite"></div><main>${state.tab==='today'?`<div class="section-head"><h2>Today's overview</h2><span class="muted">${new Date().toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})}</span></div><div class="stats"><article><div class="stat-label">🍼 Feeds</div><strong>${feeds.length}</strong><small>${milk?milk+' ml logged by bottle':''}</small></article><article><div class="stat-label">🧷 Diapers</div><strong>${diapers.length}</strong><small>${diapers.filter(a=>a.details?.type?.includes('Wet')).length} wet/mixed</small></article><article><div class="stat-label">🌙 Sleep</div><strong>${(sleepMin/60).toFixed(1)}<em> h</em></strong><small>Logged today</small></article><article><div class="stat-label">👶 Babies</div><strong>${currentBabies().length}</strong><small>Selected profiles</small></article></div><div class="section-head"><h2>Recent activity</h2><button class="link" data-tab="log">+ Add entry</button></div>${activityList(records().slice(0,30))}`:state.tab==='log'?logView():state.tab==='trends'?trendsView():state.tab==='growth'?growthView():familyView()}</main><footer>Private family workspace · Not a medical monitoring device</footer></div>`;
 document.querySelector('#logout').onclick=()=>supabase.auth.signOut();document.querySelectorAll('[data-tab]').forEach(x=>x.onclick=()=>{state.tab=x.dataset.tab;render()});document.querySelectorAll('[data-baby]').forEach(x=>x.onclick=()=>{state.baby=x.dataset.baby;render()});document.querySelectorAll('[data-delete]').forEach(x=>x.onclick=()=>removeActivity(x.dataset.delete));
 if(state.tab==='log')bindLog();if(state.tab==='growth')bindGrowth();if(state.tab==='family')bindFamily();if(state.tab==='trends')drawChart();
}
function activityList(arr){return `<section class="panel activity-list">${arr.length?arr.map(a=>`<div class="activity"><span class="activity-icon">${icon(a.kind)}</span><div class="activity-main"><strong>${esc(nameOf(a.baby_id))} · ${esc(a.kind)}</strong><span>${esc(describe(a))}</span></div><div class="activity-side"><small>${fmt(a.started_at)}</small><button aria-label="Delete activity" title="Delete activity" class="icon-button" data-delete="${a.id}">×</button></div></div>`).join(''):'<p class="muted">No activities logged yet.</p>'}</section>`}
function babyOptions(){return state.babies.map(b=>`<option value="${b.id}" ${state.baby===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}
function logView(){return `<div class="section-head"><h2>Quick log</h2><span class="muted">Save in seconds</span></div><section class="panel"><form id="log-form"><label>Baby<select name="baby_id" required>${babyOptions()}</select></label><label>Activity<select name="kind" id="kind"><option value="feed">🍼 Feeding</option><option value="diaper">🧷 Diaper</option><option value="sleep">🌙 Sleep</option><option value="medicine">💊 Medicine</option><option value="note">📝 Note</option></select></label><label>Start time<input name="started_at" type="datetime-local" required value="${isoLocal()}"></label><div id="extra"></div><button type="submit" class="full">Save activity</button></form></section><h2 class="subheading">Recent entries</h2>${activityList(records().slice(0,15))}`}
function bindLog(){const f=document.querySelector('#log-form'),kind=f.elements.kind,extra=document.querySelector('#extra');function update(){extra.innerHTML=kind.value==='feed'?`<label>Feeding method<select name="method"><option>Bottle</option><option>Breastfeeding</option><option>Expressed milk</option><option>Formula</option></select></label><div class="two"><label>Volume (ml), if measured<input type="number" min="0" max="500" step="1" name="volume_ml" placeholder="e.g. 60"></label><label>Duration (minutes)<input type="number" min="0" max="240" name="duration_min" placeholder="Optional"></label></div>`:kind.value==='diaper'?`<label>Diaper type<select name="type"><option>Wet</option><option>Dirty</option><option>Wet + dirty</option><option>Dry</option></select></label>`:kind.value==='sleep'?`<label>End time (leave blank if still sleeping)<input name="ended_at" type="datetime-local"></label>`:kind.value==='medicine'?`<label>Medicine / dose (as prescribed)<input name="text" maxlength="300" required placeholder="Name and dose"></label>`:`<label>Note<input name="text" maxlength="500" required placeholder="Observation"></label>`;}kind.onchange=update;update();f.onsubmit=async e=>{e.preventDefault();const d=new FormData(f),k=d.get('kind');const details={};for(const field of ['method','type','text'])if(d.get(field))details[field]=String(d.get(field));for(const field of ['volume_ml','duration_min'])if(d.get(field)!=='')details[field]=Number(d.get(field));const entry={family_id:state.family.id,baby_id:d.get('baby_id'),kind:k,started_at:new Date(d.get('started_at')).toISOString(),ended_at:d.get('ended_at')?new Date(d.get('ended_at')).toISOString():null,details};try{const {error:er}=await supabase.from('activities').insert(entry);if(er)throw er;await refreshData();msg('Activity saved');}catch(ex){error(ex)}}}
async function removeActivity(id){if(!confirm('Delete this activity?'))return;try{const {error:er}=await supabase.from('activities').delete().eq('id',id).eq('family_id',state.family.id);if(er)throw er;await refreshData()}catch(ex){error(ex)}}
function trendsView(){return `<div class="section-head"><h2>Last 7 days</h2><span class="muted">Activity patterns</span></div><section class="panel"><h3>Feeding and diapers by day</h3><div class="chart-wrap"><canvas id="chart" aria-label="Seven day feeding and diaper trends" role="img"></canvas></div><p class="muted small">Counts are for logged entries, not clinical targets. Direct breastfeeding volume is not estimated.</p></section><section class="panel"><h3>Download your records</h3><p class="muted">Export the currently selected babies' last 45 days of activities as CSV.</p><button id="export">Export activities CSV</button></section>`}
function drawChart(){const days=Array.from({length:7},(_,i)=>day(Date.now()-(6-i)*86400000)),r=records();state.chart=new Chart(document.querySelector('#chart'),{type:'line',data:{labels:days.map(d=>d.slice(5)),datasets:[{label:'Feeds',data:days.map(d=>r.filter(a=>day(a.started_at)===d&&a.kind==='feed').length),borderColor:'#406baf',backgroundColor:'#406baf',tension:.3},{label:'Diapers',data:days.map(d=>r.filter(a=>day(a.started_at)===d&&a.kind==='diaper').length),borderColor:'#d68c5d',backgroundColor:'#d68c5d',tension:.3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}}});document.querySelector('#export').onclick=()=>downloadCsv(records().map(a=>({baby:nameOf(a.baby_id),kind:a.kind,start:a.started_at,end:a.ended_at||'',details:JSON.stringify(a.details),entered_by:a.created_by})), 'activities.csv');}
function growthView(){const ids=new Set(currentBabies().map(b=>b.id));const rows=state.growth.filter(g=>ids.has(g.baby_id));return `<div class="section-head"><h2>Growth</h2><span class="muted">Measurements</span></div><section class="panel"><form id="growth-form"><label>Baby<select name="baby_id">${babyOptions()}</select></label><label>Measured at<input name="measured_at" type="datetime-local" value="${isoLocal()}" required></label><div class="two"><label>Weight (kg)<input name="weight_kg" type="number" min="0.001" max="39.999" step="0.001" placeholder="2.750"></label><label>Length (cm)<input name="length_cm" type="number" min="0.1" max="159.9" step="0.1" placeholder="48.0"></label></div><label>Head circumference (cm)<input name="head_cm" type="number" min="0.1" max="79.9" step="0.1" placeholder="34.0"></label><label>Notes<input name="note" maxlength="500" placeholder="Optional"></label><button class="full">Save measurement</button></form></section><section class="panel"><h3>Measurement history</h3>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Baby</th><th>Weight</th><th>Length</th><th>Head</th></tr></thead><tbody>${rows.map(g=>`<tr><td>${fmt(g.measured_at)}</td><td>${esc(nameOf(g.baby_id))}</td><td>${g.weight_kg??'—'}</td><td>${g.length_cm??'—'}</td><td>${g.head_cm??'—'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No measurements yet.</p>'}<button class="secondary" id="growth-export">Export growth CSV</button></section><p class="muted small">Use your clinician's growth chart and guidance, including corrected age when appropriate for preterm infants.</p>`}
function bindGrowth(){document.querySelector('#growth-form').onsubmit=async e=>{e.preventDefault();const d=new FormData(e.target);const entry={family_id:state.family.id,baby_id:d.get('baby_id'),measured_at:new Date(d.get('measured_at')).toISOString(),note:d.get('note')||null};for(const k of ['weight_kg','length_cm','head_cm'])if(d.get(k)!=='')entry[k]=Number(d.get(k));if(!['weight_kg','length_cm','head_cm'].some(k=>k in entry))return alert('Enter at least one measurement');try{const {error:er}=await supabase.from('growth').insert(entry);if(er)throw er;await refreshData();msg('Measurement saved')}catch(ex){error(ex)}};document.querySelector('#growth-export').onclick=()=>downloadCsv(state.growth.filter(g=>currentBabies().some(b=>b.id===g.baby_id)).map(g=>({baby:nameOf(g.baby_id),measured_at:g.measured_at,weight_kg:g.weight_kg,length_cm:g.length_cm,head_cm:g.head_cm,note:g.note})), 'growth.csv');}
function familyView(){const owner=state.members.find(m=>m.family_id===state.family.id)?.role==='owner';return `<div class="section-head"><h2>Family sharing</h2></div><section class="panel"><h3>Private workspace</h3><p class="muted">Invite a caregiver using their email address. They must register with that exact email to join.</p>${owner?`<form id="invite-form"><label>Caregiver email<input type="email" name="email" placeholder="caregiver@example.com" required></label><button>Create invitation link</button></form><div id="invite-result"></div>`:'<p class="muted">Ask the family owner to create an invitation.</p>'}</section><section class="panel"><h3>Baby profiles</h3>${state.babies.map(b=>`<p>👶 ${esc(b.name)} ${b.birth_date?'· Born '+esc(b.birth_date):''}</p>`).join('')}<p class="muted small">Only invited family members can read or write records. Invite links expire after seven days and can be used once.</p></section>`}
function bindFamily(){const f=document.querySelector('#invite-form');if(!f)return;f.onsubmit=async e=>{e.preventDefault();try{const token=inviteToken(),hash=await sha256(token),email=new FormData(f).get('email');const {error:er}=await supabase.rpc('create_family_invite',{fid:state.family.id,invited_email:email,invite_token_hash:hash});if(er)throw er;const link=location.origin+location.pathname+'#invite='+token;const box=document.querySelector('#invite-result');box.innerHTML=`<p class="success">Invitation created for ${esc(email)}. Share this link privately:</p><textarea readonly rows="3" id="invite-link"></textarea><button id="copy-invite" type="button" class="secondary">Copy invitation link</button>`;document.querySelector('#invite-link').value=link;document.querySelector('#copy-invite').onclick=async()=>{await navigator.clipboard.writeText(link);msg('Link copied')};}catch(ex){error(ex)}}}
function downloadCsv(rows,filename){if(!rows.length)return alert('No records to export');const keys=Object.keys(rows[0]),quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';const csv=[keys.map(quote).join(','),...rows.map(r=>keys.map(k=>quote(r[k])).join(','))].join('\r\n');const blob=new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function init(){if(!supabase){app.innerHTML='<main class="auth"><h1>Little Days</h1><p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before running the app. See README.md.</p></main>';return;}const {data:{session}}=await supabase.auth.getSession();state.session=session;if(session)await load();else authView();supabase.auth.onAuthStateChange((event,session)=>{const old=state.session?.user?.id;state.session=session;if(!session){if(state.channel)supabase.removeChannel(state.channel);state.channel=null;state.family=null;state.babies=[];authView()}else if(!old||old!==session.user.id){setTimeout(load,0)}})}
init().catch(error);
