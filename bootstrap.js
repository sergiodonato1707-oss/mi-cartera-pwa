/* Arranque y conexión de Mi Cartera PWA. */
const $=id=>document.getElementById(id);
const CONFIG=window.MI_CARTERA_FIREBASE_CONFIG||{};
const configured=!!(CONFIG.apiKey&&CONFIG.projectId&&CONFIG.appId&&CONFIG.authDomain);
let started=false;
let cloud=null;
let currentUser=null;
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function errorPanel(message){$('app').innerHTML=`<div class="access-page"><section class="access-card"><img class="access-logo" src="./icon-192.png" alt=""><h1>Mi Cartera</h1><p class="intro">${e(message)}</p><button class="btn primary" type="button" onclick="location.reload()">Volver a intentar</button></section></div>`;}
function startApp(){
  if(started)return;
  started=true;
  const script=document.createElement('script');script.src='./app.js';
  script.onerror=()=>errorPanel('No se pudo cargar la aplicación. Revisa tu conexión.');
  document.body.appendChild(script);
}
const authMessage={
  'auth/invalid-email':'Escribe un correo electrónico válido.',
  'auth/invalid-credential':'El correo o la contraseña no son correctos.',
  'auth/email-already-in-use':'Ese correo ya tiene una cuenta. Pulsa Entrar.',
  'auth/weak-password':'La contraseña debe tener como mínimo seis caracteres.',
  'auth/too-many-requests':'Demasiados intentos. Inténtalo después.',
  'auth/network-request-failed':'Comprueba la conexión a internet.',
  'permission-denied':'No tienes permiso para usar los datos. Revisa las reglas de Firestore.'
};
function displayError(err){return authMessage[err?.code]||authMessage[err?.message]||err?.message||'No se pudo continuar.';}
function loginPage(){
  $('app').innerHTML=`<div class="access-page"><section class="access-card">
    <img class="access-logo" src="./icon-192.png" alt="Ícono Mi Cartera">
    <h1>Mi Cartera</h1><p class="intro">Ingresa a tu cartera privada.<br>Tus préstamos y abonos estarán disponibles en celular y computador.</p>
    <form id="access-form">
      <label for="access-email">Correo electrónico</label><input required id="access-email" autocomplete="email" type="email" placeholder="tu@correo.com">
      <label for="access-pass">Contraseña</label><input required id="access-pass" autocomplete="current-password" minlength="6" type="password" placeholder="Mínimo 6 caracteres">
      <button class="btn primary" id="access-enter" type="submit">Entrar</button>
      <button class="linkbutton" id="access-create" type="button">Crear mi cuenta</button>
      <button class="linkbutton" id="access-recover" type="button">Olvidé mi contraseña</button>
    </form><p id="access-error" class="error" role="alert"></p>
    <p class="fine">Cada persona entra con su propia cuenta. Nunca compartas tu contraseña.</p></section></div>`;
  const form=$('access-form'),msg=$('access-error');
  const credentials=()=>[$('access-email').value.trim(),$('access-pass').value];
  async function attempt(type){
    const [email,password]=credentials();
    if(!email||(!password&&type!=='reset')){msg.textContent='Completa los datos de acceso.';return;}
    for(const b of form.querySelectorAll('button'))b.disabled=true;
    msg.textContent='Procesando...';
    try{
      if(type==='login')await cloud.signIn(email,password);
      if(type==='create')await cloud.signUp(email,password);
      if(type==='reset'){
        await cloud.reset(email);
        msg.textContent='Revisa tu correo para cambiar la contraseña.';
      }
      if(type!=='reset')msg.textContent='Entrando...';
    }catch(err){msg.textContent=displayError(err);}
    finally{for(const b of form.querySelectorAll('button'))b.disabled=false;}
  }
  form.addEventListener('submit',ev=>{ev.preventDefault();attempt('login');});
  $('access-create').addEventListener('click',()=>attempt('create'));
  $('access-recover').addEventListener('click',()=>attempt('reset'));
}
async function initialize(){
  if(configured){
    try{
      const {setupCloud}=await import('./firebase-adapter.js');
      cloud=setupCloud(CONFIG);
      cloud.onAuthStateChanged(user=>{
        currentUser=user;
        if(user){window.MiCarteraCloud=cloud;startApp();}
        else if(started){window.location.reload();}
        else loginPage();
      });
    }catch(err){errorPanel('No se pudo conectar con la nube: '+displayError(err));}
  }else{
    startApp();
  }
}
initialize();
// Instalar desde Chrome/Edge cuando esté disponible. En iPhone usar Compartir > Añadir a pantalla de inicio.
let installEvent;
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();installEvent=event;
  $('install-pwa').style.display='block';
});
$('install-pwa').addEventListener('click',async()=>{
  if(!installEvent)return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent=null;
  $('install-pwa').style.display='none';
});
window.addEventListener('appinstalled',()=>{$('install-pwa').style.display='none';});
if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost')){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));
}
