export const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg0:#f6f6f4;
  --bg1:#ffffff;
  --bg2:#f0f0ee;
  --bg3:#e8e8e6;
  --bg4:#dededc;
  --out:#0f6ea8;
  --in:#ffffff;
  --acc:#111111;
  --acc2:rgba(17,17,17,.08);
  --acc3:rgba(17,17,17,.05);
  --t1:#090909;
  --t2:#747474;
  --t3:#9a9a9a;
  --bdr:rgba(0,0,0,.07);
  --bdr2:rgba(0,0,0,.11);
  --green:#1aa05d;
  --red:#e5484d;
  --font:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,Arial,sans-serif;
  --shadow:0 22px 60px rgba(0,0,0,.13);
  --soft-shadow:0 16px 38px rgba(0,0,0,.08);
}
[data-theme='dark']{
  --bg0:#0b0e12;
  --bg1:#151922;
  --bg2:#1c222d;
  --bg3:#242b37;
  --bg4:#303846;
  --out:#1f6da2;
  --in:#1b222d;
  --acc:#f2f4f7;
  --acc2:rgba(255,255,255,.08);
  --acc3:rgba(255,255,255,.04);
  --t1:#f3f5f8;
  --t2:#a0a7b2;
  --t3:#737b88;
  --bdr:rgba(255,255,255,.08);
  --bdr2:rgba(255,255,255,.12);
  --shadow:0 22px 70px rgba(0,0,0,.35);
  --soft-shadow:0 16px 44px rgba(0,0,0,.28);
}
html,body,#root{height:100%}
body{
  background:var(--bg0);
  font-family:var(--font);
  color:var(--t1);
  transition:background .2s,color .2s;
}
button,input,textarea{font:inherit}
button{color:inherit}
.scroll{overflow-y:auto}
.scroll::-webkit-scrollbar{width:4px}
.scroll::-webkit-scrollbar-thumb{background:var(--bg4);border-radius:999px}
.trim{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes pop{0%{transform:scale(.92);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}

.boot-screen{
  min-height:100vh;
  display:flex;
  flex-direction:column;
  gap:22px;
  align-items:center;
  justify-content:center;
  background:var(--bg0);
}
.boot-mark{
  width:74px;height:74px;border-radius:28px;
  background:var(--bg1);
  box-shadow:var(--soft-shadow);
  display:flex;align-items:center;justify-content:center;
  font-size:34px;font-weight:800;
}
.spinner{
  width:26px;height:26px;
  border:2px solid var(--bdr2);
  border-top-color:var(--acc);
  border-radius:50%;
  animation:spin .7s linear infinite;
}

/* AUTH */
.auth{
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:22px;
  background:
    radial-gradient(circle at 20% 0%,rgba(255,255,255,.85),transparent 32%),
    linear-gradient(180deg,#f8f8f7,var(--bg0));
}
.auth-glow{display:none}
.auth-card{
  width:min(420px,100%);
  background:rgba(255,255,255,.78);
  border:1px solid rgba(255,255,255,.8);
  border-radius:36px;
  padding:34px 28px 30px;
  box-shadow:var(--shadow);
  backdrop-filter:blur(22px);
  animation:fadeUp .25s ease;
}
[data-theme='dark'] .auth-card{
  background:rgba(21,25,34,.72);
  border-color:var(--bdr2);
}
.auth-logo{
  width:74px;height:74px;
  border-radius:28px;
  background:#111;
  color:#fff;
  display:flex;align-items:center;justify-content:center;
  margin:0 auto 24px;
  font-size:28px;
  box-shadow:0 18px 44px rgba(0,0,0,.16);
}
.auth-title{
  font-size:28px;
  letter-spacing:-.04em;
  text-align:center;
  margin-bottom:8px;
}
.auth-sub{
  font-size:14px;
  color:var(--t2);
  text-align:center;
  line-height:1.5;
  margin-bottom:24px;
}
.auth-label,.field-label{
  display:block;
  font-size:12px;
  color:var(--t2);
  font-weight:700;
  margin:0 0 8px;
}
.inp,.field-inp,.search-inp{
  width:100%;
  height:50px;
  border:none;
  outline:none;
  border-radius:18px;
  background:var(--bg2);
  color:var(--t1);
  padding:0 16px;
  font-size:16px;
}
.inp:focus,.field-inp:focus{
  box-shadow:0 0 0 3px var(--acc2);
}
.phone-row{display:flex;gap:10px;margin-bottom:14px}
.prefix{
  height:50px;
  padding:0 14px;
  display:flex;align-items:center;
  background:var(--bg2);
  border-radius:18px;
  color:var(--t1);
}
.btn-primary,.btn-pri{
  border:none;
  background:#111;
  color:#fff;
  border-radius:18px;
  height:48px;
  padding:0 18px;
  font-weight:800;
  cursor:pointer;
  transition:opacity .15s,transform .12s;
}
[data-theme='dark'] .btn-primary,[data-theme='dark'] .btn-pri{
  background:#f3f5f8;
  color:#08090b;
}
.btn-primary{width:100%;margin-top:16px}
.btn-primary:active,.btn-pri:active{transform:scale(.98)}
.btn-primary:disabled,.btn-pri:disabled,.btn-sec:disabled{opacity:.45;cursor:default}
.btn-sec{
  border:none;
  background:var(--bg2);
  color:var(--t1);
  border-radius:18px;
  height:48px;
  padding:0 18px;
  font-weight:800;
  cursor:pointer;
}
.btn-row{display:flex;gap:10px;margin-top:18px}
.btn-row>*{flex:1}
.btn-pri.full{width:100%;margin-top:12px}
.err-bar,.ok-bar{
  border-radius:18px;
  padding:12px 14px;
  margin:0 0 14px;
  font-size:13px;
}
.err-bar{background:rgba(229,72,77,.12);color:var(--red)}
.ok-bar{background:rgba(26,160,93,.13);color:var(--green)}
.auth-hint{
  margin-top:14px;
  color:var(--t2);
  font-size:13px;
  text-align:center;
}
.back-btn{
  border:none;background:transparent;
  color:var(--t1);
  font-weight:800;
  cursor:pointer;
  margin-bottom:16px;
}
.otp-row{display:flex;gap:8px;justify-content:center;margin:18px 0}
.otp-box{
  width:48px;height:56px;
  border:none;border-radius:18px;
  background:var(--bg2);
  color:var(--t1);
  text-align:center;
  font-size:24px;
  font-weight:900;
}

/* APP SHELL */
.app{
  height:100vh;
  background:
    radial-gradient(circle at 50% -20%,rgba(255,255,255,.9),transparent 36%),
    var(--bg0);
}
.app-frame{
  height:100%;
  display:grid;
  grid-template-columns:minmax(360px,430px) 1fr;
}
.home-screen,.chat-view{
  height:100vh;
  min-width:0;
  position:relative;
  overflow:hidden;
}
.home-screen{
  background:var(--bg0);
  border-right:1px solid var(--bdr);
  display:flex;
  flex-direction:column;
}
.chat-view{
  display:flex;
  flex-direction:column;
  background:var(--bg0);
}
.ios-status-spacer{height:28px}
.home-topbar,.product-chat-head,.sheet-head{
  min-height:78px;
  padding:12px 22px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  position:relative;
  z-index:5;
}
.screen-title{
  position:absolute;
  left:50%;
  transform:translateX(-50%);
  font-size:22px;
  font-weight:800;
  letter-spacing:-.035em;
}
.avatar-button,.round-action,.bottom-round{
  border:none;
  background:var(--bg1);
  border-radius:999px;
  box-shadow:var(--soft-shadow);
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:center;
}
.avatar-button{width:54px;height:54px;background:transparent;box-shadow:none}
.avatar-face{
  width:46px;height:46px;
  border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  background:#111;color:#fff;font-weight:900;
  overflow:hidden;
}
.round-action{
  width:54px;height:54px;
  font-size:28px;
  font-weight:600;
}
.desktop-hidden{display:none}
.home-content{
  flex:1;
  padding:22px 20px 120px;
}
.conversation-list{
  display:flex;
  flex-direction:column;
  gap:8px;
}
.conversation-item{
  width:100%;
  border:none;
  background:transparent;
  display:flex;
  align-items:center;
  gap:14px;
  padding:12px;
  border-radius:24px;
  text-align:left;
  cursor:pointer;
  transition:background .15s,transform .12s;
}
.conversation-item:hover,.conversation-item.active{
  background:var(--bg1);
  box-shadow:var(--soft-shadow);
}
.conversation-item:active{transform:scale(.99)}
.conversation-main{flex:1;min-width:0}
.conversation-line{
  display:flex;
  align-items:center;
  gap:8px;
  min-width:0;
}
.conversation-name{
  flex:1;
  font-size:16px;
  font-weight:800;
  letter-spacing:-.02em;
}
.conversation-time{
  color:var(--t3);
  font-size:12px;
}
.conversation-preview{
  flex:1;
  color:var(--t2);
  font-size:14px;
}
.badge{
  min-width:22px;
  height:22px;
  padding:0 7px;
  border-radius:999px;
  background:#111;
  color:#fff;
  font-size:12px;
  display:flex;
  align-items:center;
  justify-content:center;
  font-weight:800;
}
.soft-chip,.e2ee-tag,.group-tag{
  border-radius:999px;
  background:var(--bg2);
  color:var(--t2);
  padding:2px 7px;
  font-size:11px;
  font-weight:800;
}
.floating-searchbar{
  position:absolute;
  left:18px;
  right:18px;
  bottom:22px;
  display:grid;
  grid-template-columns:58px 1fr 58px;
  gap:12px;
  align-items:center;
  z-index:8;
}
.bottom-round{
  width:58px;height:58px;
  font-size:28px;
}
.bottom-search{
  height:58px;
  border-radius:999px;
  background:var(--bg1);
  box-shadow:var(--soft-shadow);
  display:flex;
  align-items:center;
  gap:10px;
  padding:0 18px;
  color:var(--t2);
}
.bottom-search input{
  width:100%;
  border:none;
  outline:none;
  background:transparent;
  font-size:20px;
  color:var(--t1);
}
.bottom-search input::placeholder{color:var(--t2)}
.filter-popover{
  position:absolute;
  top:74px;
  right:18px;
  width:260px;
  padding:18px;
  background:rgba(255,255,255,.8);
  border:1px solid rgba(255,255,255,.9);
  border-radius:32px;
  box-shadow:var(--shadow);
  backdrop-filter:blur(26px);
  animation:pop .16s ease;
  z-index:20;
}
[data-theme='dark'] .filter-popover{
  background:rgba(24,28,37,.86);
  border-color:var(--bdr2);
}
.filter-title{
  color:var(--t2);
  font-size:14px;
  margin:0 0 12px 16px;
}
.filter-item{
  width:100%;
  height:48px;
  border:none;
  background:transparent;
  border-radius:16px;
  display:grid;
  grid-template-columns:34px 1fr;
  align-items:center;
  text-align:left;
  font-size:20px;
  cursor:pointer;
}
.filter-item:hover{background:var(--acc3)}
.filter-check{text-align:center;font-size:22px}
.filter-sep{height:1px;background:var(--bdr);margin:10px 0}

/* EMPTY */
.product-empty{
  min-height:100%;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  text-align:center;
  padding:42px 22px;
}
.product-empty.mini{min-height:auto;padding:32px 16px}
.product-empty-icon{
  width:84px;height:84px;
  border:7px solid var(--t1);
  border-radius:50%;
  border-bottom-left-radius:18px;
  margin-bottom:22px;
}
.product-empty-title{
  font-size:28px;
  font-weight:900;
  letter-spacing:-.04em;
}
.product-empty-sub{
  color:var(--t2);
  font-size:17px;
  line-height:1.35;
  margin-top:8px;
}

/* AVATARS */
.av{
  width:48px;height:48px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  font-size:17px;font-weight:900;
  flex-shrink:0;position:relative;overflow:hidden;
}
.av.sm{width:28px;height:28px;font-size:11px}
.av.md{width:44px;height:44px;font-size:15px}
.online-dot{
  position:absolute;
  bottom:1px;right:1px;
  width:11px;height:11px;
  border-radius:50%;
  background:var(--green);
  border:2px solid var(--bg1);
}

/* CHAT */
.product-chat-head{
  background:rgba(255,255,255,.55);
  backdrop-filter:blur(18px);
  border-bottom:1px solid var(--bdr);
}
[data-theme='dark'] .product-chat-head{background:rgba(15,18,24,.55)}
.product-chat-title{flex:1;min-width:0}
.head-name{
  font-size:18px;
  font-weight:900;
  letter-spacing:-.03em;
}
.head-status{
  font-size:13px;
  color:var(--green);
  margin-top:2px;
}
.head-status.off{color:var(--t2)}
.msgs{
  flex:1;
  padding:18px 20px 10px;
  display:flex;
  flex-direction:column;
  gap:3px;
  background:
    radial-gradient(circle at 15% 20%,rgba(0,0,0,.025),transparent 22%),
    radial-gradient(circle at 80% 0%,rgba(0,0,0,.03),transparent 30%),
    var(--bg0);
}
.date-div{
  align-self:center;
  color:var(--t2);
  font-size:12px;
  margin:8px 0 18px;
}
.msg-wrap{
  display:flex;
  align-items:flex-end;
  gap:8px;
  margin-bottom:2px;
}
.msg-wrap.out{flex-direction:row-reverse}
.bubble{
  max-width:min(68%,560px);
  padding:8px 11px;
  border-radius:20px;
  position:relative;
  font-size:15px;
  line-height:1.45;
  word-break:break-word;
  cursor:pointer;
  box-shadow:0 1px 1px rgba(0,0,0,.04);
}
.bubble.in{
  background:var(--in);
  color:var(--t1);
  border-bottom-left-radius:7px;
}
.bubble.out{
  background:var(--out);
  color:#fff;
  border-bottom-right-radius:7px;
}
.msg-meta{
  display:flex;
  align-items:center;
  gap:4px;
  justify-content:flex-end;
  font-size:11px;
  opacity:.64;
  margin-top:3px;
  float:right;
  margin-left:10px;
}
.check.read{color:#91d7ff}
.edited-mark{font-style:italic}
.msg-img{
  display:block;
  max-width:min(320px,58vw);
  max-height:360px;
  object-fit:cover;
  border-radius:16px;
  margin-bottom:6px;
}
.reply-quote{
  background:rgba(0,0,0,.07);
  border-left:3px solid currentColor;
  border-radius:10px;
  padding:5px 8px;
  margin-bottom:7px;
  font-size:12px;
  opacity:.8;
}
.reply-q-name{font-weight:800;margin-bottom:2px}
.reply-q-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px}
.message-reactions,.reaction-row{
  display:flex;
  gap:4px;
  flex-wrap:wrap;
  margin-top:7px;
  clear:both;
}
.reaction-chip{
  display:inline-flex;
  align-items:center;
  gap:4px;
  border:1px solid rgba(255,255,255,.22);
  background:rgba(255,255,255,.18);
  color:inherit;
  border-radius:999px;
  padding:2px 7px;
  font-size:12px;
  cursor:pointer;
}
.bubble.in .reaction-chip{
  border-color:var(--bdr2);
  background:var(--bg2);
}
.reaction-chip.mine{
  border-color:#111;
  background:rgba(0,0,0,.1);
}
.enc-notice{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:5px;
  padding:7px 12px;
  font-size:12px;
  color:var(--t2);
  background:var(--bg0);
}
.typing{
  display:flex;
  align-items:center;
  gap:4px;
  padding:13px 16px;
  border-radius:20px;
  background:var(--in);
}
.td{
  width:6px;height:6px;
  border-radius:50%;
  background:var(--t2);
  animation:bounce 1.2s infinite;
}
.td:nth-child(2){animation-delay:.15s}
.td:nth-child(3){animation-delay:.3s}

/* INPUT */
.reply-prev{
  margin:8px 14px 0;
  padding:10px 12px;
  border-radius:18px;
  background:var(--bg1);
  display:flex;
  align-items:center;
  gap:10px;
  box-shadow:var(--soft-shadow);
}
.reply-prev-inner{flex:1;min-width:0}
.reply-prev-name{font-size:12px;font-weight:900}
.reply-prev-txt{font-size:13px;color:var(--t2)}
.input-bar{
  padding:10px 14px 16px;
  display:flex;
  align-items:flex-end;
  gap:10px;
  background:var(--bg0);
  position:relative;
}
.inp-area{
  flex:1;
  min-height:52px;
  border-radius:999px;
  background:var(--bg1);
  box-shadow:var(--soft-shadow);
  display:flex;
  align-items:flex-end;
  gap:8px;
  padding:8px 8px 8px 12px;
}
.msg-inp{
  flex:1;
  min-height:30px;
  max-height:120px;
  border:none;
  outline:none;
  background:transparent;
  color:var(--t1);
  resize:none;
  font-size:16px;
  line-height:1.55;
  padding:3px 0;
}
.msg-inp::placeholder{color:var(--t2)}
.emoji-trigger{
  border:none;background:transparent;
  cursor:pointer;
  font-size:20px;
  height:34px;
  width:34px;
  display:flex;
  align-items:center;
  justify-content:center;
}
.send-btn{
  width:52px;height:52px;
  border:none;
  border-radius:50%;
  background:#111;
  color:#fff;
  font-size:20px;
  cursor:pointer;
  box-shadow:var(--soft-shadow);
}
[data-theme='dark'] .send-btn{background:#f3f5f8;color:#08090b}
.send-btn:disabled{opacity:.35;cursor:default}
.emoji-picker{
  position:absolute;
  bottom:calc(100% + 8px);
  left:14px;
  width:310px;
  padding:12px;
  background:rgba(255,255,255,.86);
  border:1px solid rgba(255,255,255,.95);
  border-radius:28px;
  box-shadow:var(--shadow);
  backdrop-filter:blur(24px);
  z-index:40;
}
[data-theme='dark'] .emoji-picker{
  background:rgba(24,28,37,.9);
  border-color:var(--bdr2);
}
.emoji-cats,.emoji-grid{display:grid;gap:6px}
.emoji-cats{
  grid-template-columns:repeat(5,1fr);
  margin-bottom:10px;
}
.emoji-grid{grid-template-columns:repeat(8,1fr)}
.emoji-cat-btn,.emoji-btn{
  border:none;
  background:transparent;
  border-radius:12px;
  cursor:pointer;
  height:34px;
  font-size:18px;
}
.emoji-cat-btn:hover,.emoji-btn:hover,.emoji-cat-btn.active{background:var(--bg2)}
.emoji-section-head{
  display:flex;
  justify-content:space-between;
  color:var(--t2);
  font-size:13px;
  margin:7px 2px 10px;
}
.emoji-clear-btn{border:none;background:transparent;color:var(--t1);cursor:pointer}
.emoji-empty{
  grid-column:1/-1;
  color:var(--t2);
  text-align:center;
  padding:20px 8px;
}

/* CONTEXT MENU */
.ctx-menu{
  position:fixed;
  min-width:186px;
  padding:8px;
  background:rgba(255,255,255,.84);
  border:1px solid rgba(255,255,255,.9);
  border-radius:22px;
  box-shadow:var(--shadow);
  backdrop-filter:blur(24px);
  z-index:200;
  animation:pop .14s ease;
}
[data-theme='dark'] .ctx-menu{
  background:rgba(24,28,37,.92);
  border-color:var(--bdr2);
}
.ctx-reactions{
  display:grid;
  grid-template-columns:repeat(6,1fr);
  gap:3px;
  padding:3px;
}
.ctx-react{
  height:30px;
  border:none;
  border-radius:11px;
  background:transparent;
  cursor:pointer;
  font-size:17px;
}
.ctx-react:hover{background:var(--bg2)}
.ctx-item{
  width:100%;
  height:42px;
  border:none;
  background:transparent;
  border-radius:13px;
  display:flex;
  align-items:center;
  gap:10px;
  padding:0 12px;
  font-size:15px;
  font-weight:700;
  cursor:pointer;
}
.ctx-item:hover{background:var(--bg2)}
.ctx-item.danger{color:var(--red)}
.ci{width:20px;text-align:center}
.menu-line{height:1px;background:var(--bdr);margin:6px}

/* SHEETS / SETTINGS / NEW CHAT */
.sheet-bg,.modal-bg{
  position:fixed;
  inset:0;
  background:rgba(0,0,0,.22);
  display:flex;
  align-items:stretch;
  justify-content:center;
  z-index:250;
  animation:fadeIn .16s ease;
}
.settings-screen,.new-chat-screen{
  width:min(100%,520px);
  height:100%;
  background:var(--bg0);
  border-radius:0;
  display:flex;
  flex-direction:column;
  overflow:hidden;
  animation:fadeUp .18s ease;
}
.settings-content,.new-chat-list{
  flex:1;
  padding:18px 22px 32px;
}
.settings-profile-card,.new-chat-action,.user-row{
  width:100%;
  border:none;
  background:var(--bg1);
  border-radius:28px;
  padding:18px;
  display:flex;
  align-items:center;
  gap:16px;
  text-align:left;
  cursor:pointer;
  box-shadow:none;
}
.settings-profile-card i,.new-chat-action i,.user-row i{
  margin-left:auto;
  color:var(--t3);
  font-style:normal;
  font-size:28px;
}
.settings-avatar{
  width:64px;height:64px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  color:#fff;font-weight:900;font-size:20px;
  flex-shrink:0;
}
.settings-profile-main,.user-row-main,.new-chat-action span:not(.new-chat-action-icon){
  display:flex;
  flex-direction:column;
  min-width:0;
}
.settings-profile-main b,.user-row-main b,.new-chat-action b{
  font-size:20px;
  letter-spacing:-.03em;
}
.settings-profile-main small,.user-row-main small,.new-chat-action small{
  color:var(--t2);
  font-size:15px;
  margin-top:3px;
}
.settings-section{margin-top:28px}
.section-title{
  color:var(--t2);
  font-weight:800;
  font-size:17px;
  margin:0 0 10px 24px;
}
.settings-card{
  background:var(--bg1);
  border-radius:28px;
  overflow:hidden;
}
.settings-row{
  width:100%;
  min-height:58px;
  border:none;
  background:transparent;
  display:grid;
  grid-template-columns:36px 1fr auto 20px;
  gap:12px;
  align-items:center;
  padding:0 18px;
  text-align:left;
  cursor:pointer;
  border-bottom:1px solid var(--bdr);
}
.settings-row:last-child{border-bottom:none}
.settings-row.disabled{cursor:default;opacity:.72}
.settings-row-icon{
  color:var(--t2);
  font-size:24px;
  text-align:center;
}
.settings-row-title{
  font-size:18px;
  font-weight:650;
}
.settings-row-value{
  color:var(--t2);
  font-size:13px;
}
.settings-row i{font-style:normal;color:var(--t3)}
.logout-row{
  width:100%;
  margin-top:28px;
  height:58px;
  border:none;
  border-radius:28px;
  background:rgba(229,72,77,.12);
  color:var(--red);
  font-size:18px;
  font-weight:900;
  cursor:pointer;
}
.field{display:block;margin-bottom:14px}
.field-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:12px;
}
.username-check{
  display:block;
  min-height:18px;
  font-size:12px;
  margin-top:5px;
}
.username-ok{color:var(--green)}
.username-err{color:var(--red)}
.avatar-grid{
  display:grid;
  grid-template-columns:repeat(5,1fr);
  gap:8px;
}
.avatar-grid.compact{margin:8px 0 14px}
.avatar-opt{
  aspect-ratio:1;
  border:2px solid transparent;
  border-radius:18px;
  cursor:pointer;
  font-size:22px;
}
.avatar-opt.sel{
  border-color:#111;
  box-shadow:0 0 0 3px var(--acc2);
}
.sheet-search{
  height:58px;
  margin:0 22px 16px;
  border-radius:999px;
  background:var(--bg1);
  display:flex;
  align-items:center;
  gap:10px;
  padding:0 18px;
  color:var(--t2);
}
.sheet-search input{
  flex:1;
  border:none;
  outline:none;
  background:transparent;
  color:var(--t1);
  font-size:20px;
}
.mode-switch{
  margin:0 22px 16px;
  height:42px;
  border-radius:999px;
  padding:3px;
  background:var(--bg3);
  display:grid;
  grid-template-columns:1fr 1fr;
}
.mode-switch button{
  border:none;
  border-radius:999px;
  background:transparent;
  cursor:pointer;
  font-weight:850;
  font-size:15px;
}
.mode-switch button.active{
  background:var(--bg1);
  box-shadow:0 1px 6px rgba(0,0,0,.06);
}
.new-chat-action{margin-bottom:10px}
.new-chat-action.disabled{opacity:.65}
.new-chat-action-icon{
  width:56px;height:56px;
  border-radius:50%;
  background:var(--bg3);
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:24px;
}
.group-create-card{
  background:var(--bg1);
  border-radius:28px;
  padding:18px;
  margin-bottom:12px;
}
.selected-users{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  margin-top:12px;
}
.selected-users button{
  border:none;
  background:var(--bg2);
  border-radius:999px;
  padding:7px 10px;
  cursor:pointer;
}
.user-row{
  margin-bottom:8px;
  background:transparent;
  box-shadow:none;
}
.user-row:hover,.user-row.selected{background:var(--bg1)}
.sheet-bottom{
  padding:12px 22px 24px;
  display:flex;
  gap:10px;
}

/* OLD MODAL COMPAT */
.modal{
  width:min(420px,92vw);
  align-self:center;
  background:var(--bg1);
  border-radius:28px;
  padding:24px;
  box-shadow:var(--shadow);
}
.small-modal{width:min(380px,92vw)}
.modal-title{
  display:flex;
  justify-content:space-between;
  align-items:center;
  font-size:20px;
  font-weight:900;
  margin-bottom:18px;
}
.modal-close{
  border:none;
  background:var(--bg2);
  width:36px;height:36px;
  border-radius:50%;
  cursor:pointer;
  font-size:20px;
}
.edit-textarea{
  height:auto;
  min-height:110px;
  padding:14px;
  resize:vertical;
}
.confirm-text{color:var(--t2);line-height:1.45;margin-bottom:14px}
.delete-actions{display:flex;flex-direction:column;gap:10px}
.danger-pri{background:var(--red)!important;color:#fff!important}

/* LIGHTBOX */
.lightbox{
  position:fixed;
  inset:0;
  z-index:300;
  background:rgba(0,0,0,.9);
  display:flex;
  align-items:center;
  justify-content:center;
}
.lightbox img{
  max-width:92vw;
  max-height:92vh;
  border-radius:18px;
}

/* RESPONSIVE */
@media (max-width: 860px){
  .app-frame{
    display:block;
  }
  .home-screen,.chat-view{
    position:absolute;
    inset:0;
    border-right:none;
    transition:transform .22s ease,opacity .22s ease;
  }
  .chat-view{
    transform:translateX(100%);
    opacity:0;
    pointer-events:none;
  }
  .has-active-chat .home-screen{
    transform:translateX(-18%);
    opacity:0;
    pointer-events:none;
  }
  .has-active-chat .chat-view{
    transform:translateX(0);
    opacity:1;
    pointer-events:auto;
  }
  .desktop-hidden{display:flex}
  .bubble{max-width:78%}
}
@media (min-width: 861px){
  .mobile-product-shell{
    background:linear-gradient(180deg,#f7f7f6,var(--bg0));
  }
  .app-frame{
    max-width:1280px;
    margin:0 auto;
  }
}
@media (max-width: 520px){
  .home-topbar,.product-chat-head,.sheet-head{padding-left:20px;padding-right:20px}
  .home-content{padding-left:14px;padding-right:14px}
  .floating-searchbar{left:16px;right:16px;grid-template-columns:56px 1fr 56px}
  .bottom-round{width:56px;height:56px}
  .bubble{max-width:82%}
  .field-grid{grid-template-columns:1fr}
}

/* PART_3_CHAT_SEARCH_UI START */
.chat-head-actions{
  display:flex;
  align-items:center;
  gap:8px;
}

.chat-head-btn{
  width:44px;
  height:44px;
  border:none;
  border-radius:50%;
  background:var(--bg1);
  color:var(--t1);
  box-shadow:var(--soft-shadow);
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:19px;
  font-weight:900;
}

.chat-head-btn.active{
  box-shadow:0 0 0 3px var(--acc2), var(--soft-shadow);
}

.chat-search-bar{
  margin:10px 16px 0;
  height:50px;
  border-radius:999px;
  background:var(--bg1);
  box-shadow:var(--soft-shadow);
  display:flex;
  align-items:center;
  gap:10px;
  padding:0 14px 0 18px;
  color:var(--t2);
  z-index:6;
}

.chat-search-bar input{
  flex:1;
  min-width:0;
  border:none;
  outline:none;
  background:transparent;
  color:var(--t1);
  font-size:16px;
}

.chat-search-bar b{
  min-width:26px;
  text-align:center;
  color:var(--t2);
  font-size:13px;
}

.chat-search-bar button{
  width:32px;
  height:32px;
  border:none;
  border-radius:50%;
  background:var(--bg2);
  color:var(--t1);
  cursor:pointer;
  font-size:18px;
}

.chat-tools-panel{
  position:absolute;
  right:16px;
  top:96px;
  width:min(360px,calc(100% - 32px));
  background:rgba(255,255,255,.88);
  border:1px solid rgba(255,255,255,.95);
  border-radius:28px;
  box-shadow:var(--shadow);
  backdrop-filter:blur(26px);
  z-index:30;
  padding:16px;
  animation:pop .16s ease;
}

[data-theme='dark'] .chat-tools-panel{
  background:rgba(24,28,37,.92);
  border-color:var(--bdr2);
}

.chat-tools-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  margin-bottom:12px;
}

.chat-tools-head b{
  display:block;
  font-size:18px;
  letter-spacing:-.03em;
}

.chat-tools-head span{
  display:block;
  margin-top:3px;
  color:var(--t2);
  font-size:13px;
}

.chat-tools-head button{
  width:34px;
  height:34px;
  border:none;
  border-radius:50%;
  background:var(--bg2);
  color:var(--t1);
  cursor:pointer;
  font-size:18px;
}

.tool-row{
  width:100%;
  min-height:52px;
  border:none;
  background:var(--bg1);
  border-radius:18px;
  display:grid;
  grid-template-columns:30px 1fr auto;
  align-items:center;
  gap:10px;
  padding:0 14px;
  margin-bottom:10px;
  text-align:left;
  cursor:pointer;
}

.tool-row span{
  font-size:20px;
  color:var(--t2);
  text-align:center;
}

.tool-row b{
  font-size:15px;
}

.tool-row i,
.tool-row em{
  font-style:normal;
  color:var(--t3);
}

.tool-row.disabled{
  opacity:.65;
  cursor:default;
}

.tool-card{
  background:var(--bg1);
  border-radius:22px;
  padding:14px;
  margin-bottom:10px;
}

.tool-title{
  font-size:13px;
  color:var(--t2);
  font-weight:900;
  margin-bottom:10px;
}

.tool-note{
  font-size:13px;
  line-height:1.45;
  color:var(--t2);
}

.bg-picker{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:8px;
}

.bg-option{
  border:none;
  background:transparent;
  cursor:pointer;
  color:var(--t1);
}

.bg-option span{
  display:block;
  height:48px;
  border-radius:16px;
  border:2px solid transparent;
  margin-bottom:5px;
}

.bg-option b{
  font-size:11px;
  font-weight:800;
}

.bg-option.active span{
  border-color:var(--acc);
  box-shadow:0 0 0 3px var(--acc2);
}

.bg-clean span{
  background:linear-gradient(135deg,#f6f6f4,#ffffff);
}

.bg-soft span{
  background:radial-gradient(circle at 30% 30%,#ffffff,transparent 40%),linear-gradient(135deg,#eef3f8,#f8f2ef);
}

.bg-grid span{
  background:
    linear-gradient(rgba(0,0,0,.055) 1px,transparent 1px),
    linear-gradient(90deg,rgba(0,0,0,.055) 1px,transparent 1px),
    #f8f8f7;
  background-size:12px 12px;
}

.bg-paper span{
  background:
    radial-gradient(circle at 10% 20%,rgba(0,0,0,.05),transparent 16%),
    radial-gradient(circle at 80% 10%,rgba(0,0,0,.05),transparent 18%),
    #f3efe7;
}

.chat-bg-clean .msgs{
  background:var(--bg0);
}

.chat-bg-soft .msgs{
  background:
    radial-gradient(circle at 20% 0%,rgba(255,255,255,.9),transparent 34%),
    radial-gradient(circle at 80% 18%,rgba(15,110,168,.07),transparent 28%),
    linear-gradient(180deg,var(--bg0),#f2f0ed);
}

.chat-bg-grid .msgs{
  background:
    linear-gradient(rgba(0,0,0,.035) 1px,transparent 1px),
    linear-gradient(90deg,rgba(0,0,0,.035) 1px,transparent 1px),
    var(--bg0);
  background-size:18px 18px;
}

.chat-bg-paper .msgs{
  background:
    radial-gradient(circle at 12% 22%,rgba(0,0,0,.035),transparent 14%),
    radial-gradient(circle at 76% 6%,rgba(0,0,0,.035),transparent 20%),
    radial-gradient(circle at 92% 70%,rgba(0,0,0,.025),transparent 18%),
    #f3efe7;
}

[data-theme='dark'] .chat-bg-paper .msgs,
[data-theme='dark'] .chat-bg-soft .msgs,
[data-theme='dark'] .chat-bg-grid .msgs{
  background:
    radial-gradient(circle at 20% 0%,rgba(255,255,255,.05),transparent 32%),
    var(--bg0);
}

.msg-wrap.search-hit .bubble{
  box-shadow:0 0 0 3px rgba(255,193,7,.28), 0 1px 1px rgba(0,0,0,.04);
}

.msg-search-mark{
  background:rgba(255,193,7,.45);
  color:inherit;
  border-radius:5px;
  padding:0 2px;
}
/* PART_3_CHAT_SEARCH_UI END */

/* HOTFIX_RESTORE_CHAT_UI START */
.floating-searchbar.restored{
  grid-template-columns:1fr 58px;
}

.restored-search{
  width:100%;
}

.filter-top-btn.active,
.bottom-round.active{
  box-shadow:0 0 0 3px var(--acc2), var(--soft-shadow);
}

.list-hint{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  color:var(--t2);
  font-size:13px;
  font-weight:800;
  padding:0 12px 12px;
}

.list-hint b{
  font-weight:700;
  color:var(--t3);
  max-width:190px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
/* HOTFIX_RESTORE_CHAT_UI END */`;