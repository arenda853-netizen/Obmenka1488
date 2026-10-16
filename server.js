'use strict';
// Zyro server — Node 18+, без внешних зависимостей. Запуск: ADMIN_PASSWORD=... node server.js
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
const PORT=+process.env.PORT||3000, DIR=process.env.DATA_DIR||path.join(__dirname,'data'), PUB=path.join(__dirname,'public');
let OWNER=process.env.ADMIN_PASSWORD;
if(!OWNER){OWNER=crypto.randomBytes(9).toString('base64url');console.log('ADMIN_PASSWORD не задан. Временный пароль владельца:',OWNER);}
fs.mkdirSync(DIR,{recursive:true});
const F=path.join(DIR,'db.json');
let db={rev:0,idc:{sellers:{},listings:{},reports:{},activity:{},support:{}},kv:{},accounts:{},sess:{}};
try{const d=JSON.parse(fs.readFileSync(F,'utf8'));db=Object.assign(db,d);db.idc=Object.assign({sellers:{},listings:{},reports:{},activity:{},support:{}},d.idc);}catch(e){}
let tm=null;
function save(){db.rev++;clearTimeout(tm);tm=setTimeout(()=>{const t=F+'.tmp';fs.writeFileSync(t,JSON.stringify(db));fs.renameSync(t,F);},250);}
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const eq=(a,b)=>{const x=Buffer.from(sha(a)),y=Buffer.from(sha(b));return crypto.timingSafeEqual(x,y);};
const supKey=n=>'u_'+(String(n).toLowerCase().replace(/[^a-z0-9а-яё]+/gi,'_')||'me');
const KV_PUB=['gameEdits','specEdits','customGames','noHold'],KV_ADM=['logs','ownerLast','staff'];
const OPEN={listings:['sold','soldTo','views'],sellers:['reviews','rating','deals']};
const hits=new Map();
function limited(ip,n){const t=Date.now(),a=(hits.get(ip)||[]).filter(x=>t-x<60000);a.push(t);hits.set(ip,a);return a.length>n;}
function newTok(o){const t=crypto.randomBytes(24).toString('base64url');db.sess[sha(t)]=o;return t;}
function ctx(req){
  const c={key:null,nick:null,adm:null},now=Date.now();
  const u=db.sess[sha(req.headers['x-token']||'-')];
  if(u&&u.t==='u'&&u.exp>now&&db.accounts[u.key]){c.key=u.key;c.nick=db.accounts[u.key].nickname;}
  const a=db.sess[sha(req.headers['x-admin']||'-')];
  if(a&&a.t==='a'&&a.exp>now){
    if(a.role==='owner')c.adm={role:'owner'};
    else{const s=(db.kv.staff||{})[a.staffId];if(s&&s.role===a.role)c.adm={role:a.role,staffId:a.staffId};}
  }
  return c;
}
function applyOp(o,c){
  const k=o.k,id=o.id,v=o.v;
  if(db.idc[k]){
    if(typeof id!=='string'||id.length>80)return false;
    const col=db.idc[k],cur=col[id];
    let mine=false;
    if(k==='sellers')mine=!!c.key&&id==='u_'+c.key;
    else if(k==='listings')mine=!!c.key&&((v&&v.sellerId)||(cur&&cur.sellerId))==='u_'+c.key&&(!cur||cur.sellerId==='u_'+c.key);
    else if(k==='support')mine=!!c.key&&id===supKey(c.nick);
    else if(k==='activity')mine=id==='guest'||id===c.key;
    else if(k==='reports')mine=!!c.key;
    if(c.adm||mine){if(v===null)delete col[id];else col[id]=v;return true;}
    if(v&&cur&&OPEN[k]){OPEN[k].forEach(f=>{if(f in v)cur[f]=v[f];});return true;}
    return false;
  }
  if(KV_PUB.includes(k)||KV_ADM.includes(k)){
    if(!c.adm||(k==='staff'&&c.adm.role!=='owner'))return false;
    db.kv[k]=v;return true;
  }
  if(k==='accounts'&&c.adm&&db.accounts[id]&&v&&typeof v==='object'){
    const r=Object.assign({},v);['salt','hash','data','nickname','uid'].forEach(f=>delete r[f]);
    Object.assign(db.accounts[id],r);return true;
  }
  return false;
}
function view(c){
  const out={idc:{},kv:{}};
  ['sellers','listings'].forEach(k=>out.idc[k]=db.idc[k]);
  out.idc.support=c.adm?db.idc.support:(c.key&&db.idc.support[supKey(c.nick)]?{[supKey(c.nick)]:db.idc.support[supKey(c.nick)]}:{});
  if(c.adm){out.idc.reports=db.idc.reports;out.idc.activity=db.idc.activity;}
  KV_PUB.forEach(k=>{if(db.kv[k]!==undefined)out.kv[k]=db.kv[k];});
  if(c.adm){
    ['logs','ownerLast'].forEach(k=>{if(db.kv[k]!==undefined)out.kv[k]=db.kv[k];});
    const st=JSON.parse(JSON.stringify(db.kv.staff||{}));
    if(c.adm.role!=='owner')Object.values(st).forEach(s=>delete s.hash);
    out.kv.staff=st;
    out.accounts={};
    Object.keys(db.accounts).forEach(k=>{const a=Object.assign({},db.accounts[k]);delete a.salt;delete a.hash;delete a.data;out.accounts[k]=a;});
  }
  return out;
}
function body(req){return new Promise((res,rej)=>{let n=0;const b=[];req.on('data',d=>{n+=d.length;if(n>12e6){rej(new Error('big'));req.destroy();}else b.push(d);});req.on('end',()=>{try{res(b.length?JSON.parse(Buffer.concat(b)):{});}catch(e){rej(e);}});});}
function send(res,code,o){const s=JSON.stringify(o);res.writeHead(code,{'content-type':'application/json;charset=utf-8','cache-control':'no-store'});res.end(s);}
const MIME={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json'};
function stat(req,res,p){
  let f=path.normalize(path.join(PUB,p==='/'?'index.html':p));
  if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(PUB,'index.html');
  const h={'content-type':MIME[path.extname(f)]||'application/octet-stream','x-content-type-options':'nosniff','referrer-policy':'same-origin','cache-control':f.endsWith('.html')||f.endsWith('.js')?'no-cache':'public,max-age=86400'};
  let d=fs.readFileSync(f);
  if(/gzip/.test(req.headers['accept-encoding']||'')&&/html|javascript|json|svg/.test(h['content-type'])){d=zlib.gzipSync(d);h['content-encoding']='gzip';}
  res.writeHead(200,h);res.end(d);
}
http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x'),p=u.pathname,ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
  if(p==='/healthz')return send(res,200,{ok:true,rev:db.rev});
  if(!p.startsWith('/api/'))return stat(req,res,p);
  try{
    const c=ctx(req);
    if(req.method==='GET'&&p==='/api/sync'){
      const r=+u.searchParams.get('rev');
      if(r===db.rev)return send(res,200,{same:true,rev:db.rev});
      const out=view(c);out.rev=db.rev;out.empty=!Object.keys(db.idc.listings).length;
      out.admin=c.adm||null;
      if(c.key){const a=db.accounts[c.key];out.acc={key:c.key,name:a.nickname,data:a.data||null};}
      return send(res,200,out);
    }
    if(req.method!=='POST')return send(res,405,{error:'method'});
    const b=await body(req);
    if(p==='/api/auth/register'||p==='/api/auth/login'){
      if(limited(ip,12))return send(res,429,{error:'Слишком много попыток. Подождите минуту.'});
      const nick=String(b.nick||'').trim(),key=nick.toLowerCase(),pw=String(b.password||'');
      if(p.endsWith('register')){
        if(nick.length<2||nick.length>24)return send(res,400,{error:'Ник: от 2 до 24 символов.'});
        if(pw.length<6)return send(res,400,{error:'Пароль должен быть не короче 6 символов.'});
        if(db.accounts[key])return send(res,409,{error:'Такой ник уже занят, придумайте другой.'});
        const salt=crypto.randomBytes(16).toString('hex');
        db.accounts[key]={nickname:nick,salt,hash:crypto.scryptSync(pw,salt,32).toString('hex'),uid:'U'+crypto.randomBytes(4).toString('hex').toUpperCase(),createdAt:Date.now(),status:'active',ip,device:String(b.device||'').slice(0,80),data:null};
      }else{
        const a=db.accounts[key];
        if(!a)return send(res,404,{error:'Такого аккаунта нет. Придумайте ник и пароль, чтобы зарегистрироваться.'});
        if(!crypto.timingSafeEqual(crypto.scryptSync(pw,a.salt,32),Buffer.from(a.hash,'hex')))return send(res,401,{error:'Неверный пароль.'});
        Object.assign(a,{lastLogin:Date.now(),ip,device:String(b.device||'').slice(0,80)});
      }
      const t=newTok({t:'u',key,exp:Date.now()+30*864e5});save();
      return send(res,200,{token:t,key,name:db.accounts[key].nickname});
    }
    if(p==='/api/auth/logout'){delete db.sess[sha(req.headers['x-token']||'-')];save();return send(res,200,{ok:true});}
    if(p==='/api/admin/login'){
      if(limited(ip,8))return send(res,429,{error:'Слишком много попыток. Подождите минуту.'});
      const pw=String(b.password||'');let role=null,staffId=null;
      if(eq(pw,OWNER))role='owner';
      else{const h=sha('obmenka|'+pw),st=db.kv.staff||{};for(const id in st)if(st[id].hash===h){role=st[id].role;staffId=id;break;}}
      if(!role)return send(res,401,{error:'Неверный пароль'});
      return send(res,200,{token:newTok({t:'a',role,staffId,exp:Date.now()+12*36e5}),role,staffId});
    }
    if(p==='/api/admin/logout'){delete db.sess[sha(req.headers['x-admin']||'-')];save();return send(res,200,{ok:true});}
    if(p==='/api/init'){
      if(Object.keys(db.idc.listings).length)return send(res,409,{error:'already'});
      (b.sellers||[]).forEach(s=>{if(s&&s.id)db.idc.sellers[s.id]=s;});
      (b.listings||[]).forEach(l=>{if(l&&l.id)db.idc.listings[l.id]=l;});
      save();return send(res,200,{ok:true});
    }
    if(p==='/api/sync'){
      const prev=db.rev;let rejected=0,changed=false;
      (Array.isArray(b.ops)?b.ops:[]).forEach(o=>{if(applyOp(o,c))changed=true;else rejected++;});
      if(b.acc&&c.key){db.accounts[c.key].data=b.acc;changed=true;}
      if(changed)save();
      return send(res,200,{rev:db.rev,prev,rejected});
    }
    send(res,404,{error:'not found'});
  }catch(e){send(res,400,{error:'bad request'});}
}).listen(PORT,()=>console.log('Zyro: http://localhost:'+PORT));
process.on('SIGTERM',()=>{try{fs.writeFileSync(F,JSON.stringify(db));}catch(e){}process.exit(0);});
