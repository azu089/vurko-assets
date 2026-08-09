// VURKO Publisher — TikTok Content Posting Web App (Cloudflare Worker)
// 单 Worker 同时服务：落地页 / WebApp / OAuth 回调 / 发布 API / ToS / Privacy
// 部署: wrangler deploy 或 Cloudflare API (见 README.md)
// 依赖 KV binding: VURKO_KV ; env: TT_CLIENT_KEY / TT_CLIENT_SECRET / TT_REDIRECT_URI / MODE(sandbox|production)

const TIKTOK_API = "https://open.tiktokapis.com";
const SCOPES = "user.info.basic,video.upload,video.publish";

function hexEncode(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return hexEncode(digest);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
}

function html(body, title = "VURKO Publisher") {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ---------- TikTok API helpers ----------
async function tikTokPost(path, data, token, form = false) {
  const url = TIKTOK_API + path;
  const headers = {};
  let body;
  if (form) {
    body = new URLSearchParams(data).toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else {
    body = JSON.stringify(data);
    headers["Content-Type"] = "application/json; charset=UTF-8";
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(url, { method: "POST", headers, body });
  const txt = await r.text();
  try { return { status: r.status, body: JSON.parse(txt) }; } catch { return { status: r.status, body: txt }; }
}

async function refreshToken(env, openId) {
  const kv = env.VURKO_KV;
  const raw = await kv.get(`acct:${openId}`);
  if (!raw) return null;
  const acct = JSON.parse(raw);
  const r = await tikTokPost("/v2/oauth/token/", {
    client_key: env.TT_CLIENT_KEY, client_secret: env.TT_CLIENT_SECRET,
    grant_type: "refresh_token", refresh_token: acct.refresh_token
  }, null, true);
  const b = r.body;
  if (b && b.access_token) {
    acct.access_token = b.access_token;
    if (b.refresh_token) acct.refresh_token = b.refresh_token;
    acct.expires_at = Date.now() + (b.expires_in || 86400) * 1000;
    await kv.put(`acct:${openId}`, JSON.stringify(acct));
    return acct;
  }
  return null;
}

async function getAccount(env, openId) {
  const raw = await env.VURKO_KV.get(`acct:${openId}`);
  if (!raw) return null;
  const acct = JSON.parse(raw);
  if (acct.expires_at && Date.now() > acct.expires_at - 3600_000) {
    const refreshed = await refreshToken(env, openId);
    return refreshed || acct;
  }
  return acct;
}

// ---------- Landing page ----------
function landingPage(base) {
  return html(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VURKO Publisher — 自动发布视频到 TikTok</title>
<style>
:root{--brand:#ff2e4d;--dark:#161823;--gray:#6b7280}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:var(--dark);line-height:1.6;background:#fafafa}
nav{display:flex;align-items:center;justify-content:space-between;padding:16px 32px;background:#fff;border-bottom:1px solid #eee;position:sticky;top:0}
.brand{font-weight:800;font-size:18px}.brand span{color:var(--brand)}
nav a{margin-left:20px;color:var(--gray);text-decoration:none;font-size:14px}
nav a:hover{color:var(--dark)}
.hero{text-align:center;padding:80px 24px 60px;max-width:720px;margin:0 auto}
.hero h1{font-size:42px;font-weight:800;letter-spacing:-1px}
.hero h1 span{color:var(--brand)}
.hero p{color:var(--gray);font-size:18px;margin:16px 0 32px}
.btn{display:inline-block;background:var(--brand);color:#fff;padding:14px 36px;border-radius:999px;font-size:16px;font-weight:600;text-decoration:none;transition:.2s}
.btn:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(255,46,77,.3)}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;max-width:960px;margin:0 auto 80px;padding:0 24px}
.feat{background:#fff;border:1px solid #eee;border-radius:16px;padding:24px}
.feat h3{margin-bottom:8px;font-size:16px}
.feat p{color:var(--gray);font-size:14px}
footer{border-top:1px solid #eee;padding:24px 32px;text-align:center;color:var(--gray);font-size:13px;background:#fff}
footer a{color:var(--gray);margin:0 12px}
</style></head><body>
<nav><div class="brand">VURKO <span>Publisher</span></div><div><a href="/app">打开控制台</a><a href="/docs/terms">服务条款</a><a href="/docs/privacy">隐私政策</a></div></nav>
<div class="hero"><h1>把做好的视频，<span>自动发到 TikTok</span></h1><p>VURKO Publisher 通过 TikTok 官方 Content Posting API，帮你连接账号、上传视频、一键发布，全程自动化。</p><a class="btn" href="/app">立即开始 →</a></div>
<div class="features">
<div class="feat"><h3>🔗 一键连接</h3><p>通过 TikTok 官方 OAuth 安全授权你的账号，token 加密存储，自动刷新。</p></div>
<div class="feat"><h3>🎬 视频上传发布</h3><p>上传 MP4，填写标题描述，直接发布到你的 TikTok 主页。</p></div>
<div class="feat"><h3>📊 状态实时跟踪</h3><p>每条发布任务实时显示状态：上传中 / 发布中 / 已完成 / 失败。</p></div>
</div>
<footer>© 2026 VURKO Publisher · <a href="/docs/terms">服务条款</a> · <a href="/docs/privacy">隐私政策</a> · <a href="https://www.tiktok.com/@vurko.vn" target="_blank" rel="noopener">@vurko.vn</a></footer>
</body></html>`);
}

// ---------- App page ----------
function appPage(base) {
  return html(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VURKO Publisher 控制台</title>
<style>
:root{--brand:#ff2e4d;--dark:#161823;--gray:#6b7280;--line:#eee;--bg:#fafafa}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:var(--dark);background:var(--bg)}
nav{display:flex;align-items:center;justify-content:space-between;padding:14px 24px;background:#fff;border-bottom:1px solid var(--line)}
.brand{font-weight:800}.brand span{color:var(--brand)}
nav a{color:var(--gray);text-decoration:none;font-size:13px}
.wrap{max-width:880px;margin:32px auto;padding:0 20px}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:24px;margin-bottom:20px}
.card h2{font-size:16px;margin-bottom:16px}
.btn{background:var(--brand);color:#fff;border:none;padding:10px 24px;border-radius:999px;font-size:14px;font-weight:600;cursor:pointer}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn.ghost{background:#fff;color:var(--dark);border:1px solid #ddd}
.hint{color:var(--gray);font-size:13px}
.account{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
.account img{width:48px;height:48px;border-radius:50%}
.account .name{font-weight:600}.account .uname{color:var(--gray);font-size:13px}
input[type=text],textarea{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:10px;font-size:14px;margin-bottom:12px}
textarea{min-height:70px;resize:vertical}
label{font-size:13px;color:var(--gray);display:block;margin-bottom:6px}
.file-drop{border:2px dashed #ddd;border-radius:12px;padding:28px;text-align:center;color:var(--gray);font-size:14px;cursor:pointer;margin-bottom:12px;transition:.2s}
.file-drop.over{border-color:var(--brand);background:#fff5f6}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.post{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--line);font-size:14px}
.post .st{font-weight:600;font-size:12px;padding:3px 10px;border-radius:999px}
.st.PUBLISH_COMPLETE{background:#e6f7ec;color:#0a7d33}
.st.PUBLISHING,.st.PROCESSING_UPLOAD{background:#fff4e0;color:#b26a00}
.st.FAILED{background:#fee;color:#d00000}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#161823;color:#fff;padding:12px 20px;border-radius:12px;font-size:14px;opacity:0;transition:.3s;pointer-events:none}
.toast.show{opacity:1}
</style></head><body>
<nav><div class="brand">VURKO <span>Publisher</span></div><div><a href="/">返回首页</a></div></nav>
<div class="wrap">
  <div class="card" id="accountCard"><h2>已连接的 TikTok 账号</h2><div id="accountBox"><p class="hint">加载中…</p></div></div>
  <div class="card"><h2>发布新视频</h2>
    <div class="file-drop" id="drop">点击选择或拖拽 MP4 视频到这里</div>
    <input type="file" id="file" accept="video/mp4,video/quicktime" hidden>
    <label>标题</label><input type="text" id="title" placeholder="视频标题（建议含 #话题）">
    <label>描述（可选）</label><textarea id="desc" placeholder="视频描述"></textarea>
    <div class="row"><button class="btn" id="publishBtn">🚀 立即发布</button><span class="hint" id="pubHint"></span></div>
  </div>
  <div class="card"><h2>发布记录</h2><div id="postsBox"><p class="hint">暂无记录，发布后显示在这里。</p></div></div>
</div>
<div class="toast" id="toast"></div>
<script>
const $=s=>document.querySelector(s);
const fmt=(t)=>new Date(t).toLocaleString('zh-CN',{hour12:false});
const toast=(m)=>{const t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)};
async function loadAccounts(){try{
  const r=await fetch('/api/accounts');const d=await r.json();
  const box=$('#accountBox');
  if(d.accounts&&d.accounts.length){
    box.innerHTML=d.accounts.map(a=>\`<div class="account"><img src="\${a.avatar||''}" alt=""><div><div class="name">\${a.display_name||''}</div><div class="uname">@\${a.username||a.open_id.slice(0,8)}</div></div></div>\`).join('')+'<p class="hint" style="margin-top:12px">可发布账号：'+d.accounts.length+' 个</p>';
  }else{
    box.innerHTML='<p class="hint">尚未连接 TikTok 账号。</p><p style="margin-top:12px"><a class="btn" href="/auth">🔗 连接 TikTok 账号</a></p>';
  }
}catch(e){$('#accountBox').innerHTML='<p class="hint">加载失败：'+e.message+'</p>'}}
async function loadPosts(){try{
  const r=await fetch('/api/posts');const d=await r.json();
  const box=$('#postsBox');
  if(!d.posts||!d.posts.length){box.innerHTML='<p class="hint">暂无记录，发布后显示在这里。</p>';return}
  box.innerHTML='<div>'+d.posts.slice().reverse().map(p=>\`<div class="post"><div><b>\${p.title||''}</b><div class="hint">\${fmt(p.created_at)} · \${p.publish_id||''}</div></div><span class="st \${p.status||''}">\${p.status||'UNKNOWN'}</span></div>\`).join('')+'</div>';
}catch(e){/* ignore */}}
const drop=$('#drop');const file=$('#file');
drop.onclick=()=>file.click();
drop.ondragover=e=>{e.preventDefault();drop.classList.add('over')};
drop.ondragleave=()=>drop.classList.remove('over');
drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');if(e.dataTransfer.files.length)file.files=e.dataTransfer.files;showFile()};
file.onchange=showFile;
function showFile(){const f=file.files[0];if(f){drop.textContent='✅ '+f.name+' ('+(f.size/1048576).toFixed(1)+' MB)';$('#pubHint').textContent=''}}
$('#publishBtn').onclick=async()=>{
  const f=file.files[0];const title=$('#title').value.trim();const desc=$('#desc').value.trim();
  if(!f){toast('请先选择视频');return}
  if(!title){toast('请填写标题');return}
  const btn=$('#publishBtn');btn.disabled=true;btn.textContent='发布中…';$('#pubHint').textContent='上传中，请稍候（视频越大越久）';
  try{
    const fd=new FormData();fd.append('file',f);fd.append('title',title);fd.append('desc',desc);
    const r=await fetch('/api/publish',{method:'POST',body:fd});const d=await r.json();
    if(d.error){toast('发布失败：'+(d.message||JSON.stringify(d)));return}
    toast('发布任务已提交，跟踪状态中…');$('#pubHint').textContent='publish_id: '+d.publish_id;
    pollStatus(d.publish_id);
  }catch(e){toast('发布失败：'+e.message)}
  finally{btn.disabled=false;btn.textContent='🚀 立即发布';setTimeout(loadPosts,1500)}
};
async function pollStatus(id){for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,4000));try{const r=await fetch('/api/status?publish_id='+encodeURIComponent(id));const d=await r.json();const st=(d.status||'');const el=document.querySelectorAll('.post');if(st==='PUBLISH_COMPLETE'){toast('✅ 发布完成！');loadPosts();break}if(st==='FAILED'){toast('❌ 发布失败：'+(d.message||''));loadPosts();break}}catch(e){}}loadPosts()}
loadAccounts();loadPosts();
</script></body></html>`);
}

// ---------- Terms / Privacy ----------
function legalPage(title, body) {
  return html(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — VURKO Publisher</title><style>body{font-family:-apple-system,'PingFang SC',sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#161823;line-height:1.7}h1{font-size:24px;margin-bottom:8px}.meta{color:#6b7280;font-size:13px;margin-bottom:24px}h2{font-size:17px;margin:20px 0 8px}p,li{font-size:14px;color:#374151}</style></head><body><h1>${title}</h1><div class="meta">VURKO Publisher · 最后更新：2026-08-09</div>${body}<p style="margin-top:40px;font-size:13px;color:#6b7280">© 2026 VURKO Publisher</p></body></html>`);
}
const TERMS_BODY = `<h2>一、服务说明</h2><p>VURKO Publisher 是一款通过 TikTok 官方 Content Posting API 帮助创作者/商家将视频自动发布到其 TikTok 账号的网页应用。您通过 TikTok 官方授权流程连接账号，并仅对您已授权的账号执行您主动发起的发布操作。</p>
<h2>二、账号与授权</h2><p>本应用不会存储您的 TikTok 密码。我们通过 TikTok OAuth 获取访问令牌，令牌仅用于您授权的发布功能，并支持自动刷新与主动解除连接。</p>
<h2>三、内容责任</h2><p>您对通过本应用发布的全部内容负责，包括但不限于内容合法性、版权与第三方权益。请遵守 TikTok 社区准则及适用法律。</p>
<h2>四、免责声明</h2><p>本应用按"现状"提供。因网络、平台接口变更或不可抗力导致的发布失败或数据丢失，本应用不承担相应责任。</p>`;
const PRIVACY_BODY = `<h2>一、我们收集什么</h2><p>当您连接 TikTok 账号时，我们获取并存储：您的 TikTok 公开资料（账号 ID、头像、显示名称）、访问令牌与刷新令牌（用于发布功能），以及您主动上传的视频与填写的内容。</p>
<h2>二、数据用途</h2><p>数据仅用于：验证账号身份、执行视频发布、展示发布状态与记录。我们不会将您的数据出售或用于任何与发布无关的目的。</p>
<h2>三、数据存储与安全</h2><p>令牌以加密形式存储于 Cloudflare 平台，并在失效前自动刷新。您可随时在应用内或 TikTok 设置中解除授权，解除后我们将停止使用相关令牌。</p>
<h2>四、第三方</h2><p>本应用运行于 Cloudflare 基础设施；与 TikTok 的交互遵循 TikTok 开发者服务条款与隐私政策。</p>
<h2>五、联系我们</h2><p>联系邮箱：vurko.shop@gmail.com</p>`;

// ---------- Auth ----------
async function handleAuth(env) {
  const verifier = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const challenge = await sha256Hex(verifier);
  const state = crypto.randomUUID().replace(/-/g, "");
  await env.VURKO_KV.put(`oauth:${state}`, JSON.stringify({ verifier, created: Date.now() }), { expirationTtl: 600 });
  const params = new URLSearchParams({
    client_key: env.TT_CLIENT_KEY,
    scope: SCOPES,
    response_type: "code",
    redirect_uri: env.TT_REDIRECT_URI,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return Response.redirect(`https://www.tiktok.com/v2/auth/authorize/?${params}`, 302);
}

async function handleCallback(env, url) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  if (err) return Response.redirect(`${env.APP_BASE}/app?error=` + encodeURIComponent(err), 302);
  const stored = await env.VURKO_KV.get(`oauth:${state}`);
  if (!code || !stored) return Response.redirect(`${env.APP_BASE}/app?error=invalid_state`, 302);
  const { verifier } = JSON.parse(stored);
  await env.VURKO_KV.delete(`oauth:${state}`);
  const r = await tikTokPost("/v2/oauth/token/", {
    client_key: env.TT_CLIENT_KEY, client_secret: env.TT_CLIENT_SECRET,
    code, grant_type: "authorization_code", redirect_uri: env.TT_REDIRECT_URI, code_verifier: verifier,
  }, null, true);
  const b = r.body;
  if (!b || !b.access_token) return Response.redirect(`${env.APP_BASE}/app?error=token_failed`, 302);
  const openId = b.open_id;
  const acct = {
    open_id: openId, access_token: b.access_token, refresh_token: b.refresh_token || "",
    scope: b.scope || "", expires_at: Date.now() + (b.expires_in || 86400) * 1000, connected_at: Date.now(),
  };
  // 拉取头像/昵称
  try {
    const u = await tikTokPost("/v2/user/info/?fields=open_id,display_name,avatar_url,username", {}, b.access_token);
    if (u.body && u.body.data && u.body.data.user) Object.assign(acct, { display_name: u.body.data.user.display_name, avatar: u.body.data.user.avatar_url, username: u.body.data.user.username });
  } catch {}
  await env.VURKO_KV.put(`acct:${openId}`, JSON.stringify(acct));
  return Response.redirect(`${env.APP_BASE}/app?connected=1`, 302);
}

// ---------- Publish API ----------
async function apiPublish(env, request) {
  const form = await request.formData();
  const file = form.get("file");
  const title = (form.get("title") || "VURKO Publisher").slice(0, 2200);
  const desc = (form.get("desc") || "").slice(0, 2200);
  const acctRaw = await env.VURKO_KV.list({ prefix: "acct:" });
  if (!acctRaw.keys.length) return json({ error: true, message: "请先连接 TikTok 账号" }, 400);
  const openId = acctRaw.keys[0].name.slice(5);
  const acct = await getAccount(env, openId);
  if (!acct) return json({ error: true, message: "账号令牌无效，请重新连接" }, 401);
  if (!file) return json({ error: true, message: "缺少视频文件" }, 400);
  const buf = await file.arrayBuffer();
  const size = buf.byteLength;
  const postInfo = { title, privacy_level: (env.MODE === "sandbox" ? "SELF_ONLY" : "PUBLIC_TO_EVERYONE") };
  if (desc) postInfo.video_description = desc;
  const init = await tikTokPost("/v2/post/publish/video/init/", {
    post_info: postInfo,
    source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
  }, acct.access_token);
  const d = init.body && init.body.data;
  const e = init.body && init.body.error;
  if (!d || !d.publish_id || (e && e.code && e.code !== "ok")) return json({ error: true, message: (e && e.message) || JSON.stringify(init.body) }, 500);
  const publishId = d.publish_id;
  const uploadUrl = (d.upload_url || "").replace(/\\u0026/g, "&");
  const up = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Range": `bytes 0-${size - 1}/${size}` },
    body: buf,
  });
  if (up.status >= 300) return json({ error: true, message: "上传失败 HTTP " + up.status }, 500);
  const pub = await tikTokPost("/v2/post/publish/video/publish/", { publish_id: publishId }, acct.access_token);
  const pe = pub.body && pub.body.error;
  if (pe && pe.code && pe.code !== "ok") return json({ error: true, message: (pe.message) || JSON.stringify(pub.body) }, 500);
  // 记录
  const rec = { publish_id: publishId, title, desc, status: "PUBLISHING", created_at: Date.now(), open_id: openId };
  await env.VURKO_KV.put(`post:${publishId}`, JSON.stringify(rec));
  await env.VURKO_KV.put(`acct:${openId}:last`, publishId);
  return json({ ok: true, publish_id: publishId });
}

async function apiStatus(env, url) {
  const publishId = url.searchParams.get("publish_id");
  if (!publishId) return json({ error: true, message: "缺 publish_id" }, 400);
  const acctRaw = await env.VURKO_KV.list({ prefix: "acct:" });
  if (!acctRaw.keys.length) return json({ error: true, message: "未连接账号" }, 401);
  const openId = acctRaw.keys[0].name.slice(5);
  const acct = await getAccount(env, openId);
  const r = await tikTokPost("/v2/post/publish/status/fetch/", { publish_id: publishId }, acct.access_token);
  const status = (r.body && r.body.data && r.body.data.status) || "UNKNOWN";
  const recRaw = await env.VURKO_KV.get(`post:${publishId}`);
  if (recRaw) {
    const rec = JSON.parse(recRaw);
    rec.status = status;
    if (r.body && r.body.data && r.body.data.fail_reason) rec.fail_reason = r.body.data.fail_reason;
    await env.VURKO_KV.put(`post:${publishId}`, JSON.stringify(rec));
  }
  return json({ publish_id: publishId, status, fail_reason: (r.body && r.body.data && r.body.data.fail_reason) || "" });
}

async function apiAccounts(env) {
  const list = await env.VURKO_KV.list({ prefix: "acct:" });
  const accounts = [];
  for (const k of list.keys) {
    const raw = await env.VURKO_KV.get(k.name);
    if (!raw) continue;
    const a = JSON.parse(raw);
    accounts.push({ open_id: a.open_id, display_name: a.display_name || "", username: a.username || "", avatar: a.avatar || "", scope: a.scope || "" });
  }
  return json({ accounts });
}

async function apiPosts(env) {
  const list = await env.VURKO_KV.list({ prefix: "post:" });
  const posts = [];
  for (const k of list.keys) {
    const raw = await env.VURKO_KV.get(k.name);
    if (!raw) continue;
    posts.push(JSON.parse(raw));
  }
  return json({ posts });
}

// ---------- Router ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const base = env.APP_BASE || url.origin;
    env.APP_BASE = base;
    const path = url.pathname;
    const method = request.method;

    if (method === "GET" && path === "/") return landingPage(base);
    if (method === "GET" && path === "/app") return appPage(base);
    if (method === "GET" && path === "/docs/terms") return legalPage("服务条款", TERMS_BODY);
    if (method === "GET" && path === "/docs/privacy") return legalPage("隐私政策", PRIVACY_BODY);
    if (method === "GET" && path === "/auth") return handleAuth(env);
    if (method === "GET" && path === "/callback") return handleCallback(env, url);

    if (method === "GET" && path === "/api/accounts") return apiAccounts(env);
    if (method === "GET" && path === "/api/posts") return apiPosts(env);
    if (method === "GET" && path === "/api/status") return apiStatus(env, url);
    if (method === "POST" && path === "/api/publish") return apiPublish(env, request);

    if (path === "/favicon.ico") return new Response(null, { status: 204 });
    return json({ error: true, message: "not found" }, 404);
  },
};
