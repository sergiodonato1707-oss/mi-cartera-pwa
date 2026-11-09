/*
 * Mi Cartera PWA - adaptador de almacenamiento seguro con Firebase Auth + Firestore.
 * Cada usuario opera únicamente en users/<su uid>/{loans,payments}.
 * Requiere activar las reglas suministradas en firestore.rules.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail }
  from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getFirestore, collection, doc, getDocs, getDoc, setDoc,
  updateDoc, deleteDoc, writeBatch, runTransaction, query, where }
  from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';

const MAX_LOANS=10000;
const clean = v => String(v ?? '').trim();
const int = x => Number(x);
const validDate=s=>typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s+'T12:00:00Z')) &&
  new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const loanTotal=l=>Math.round(Number(l.principal)*(1+(l.frequency==='semanal'?.05:l.frequency==='quincenal'?.10:.20)*Number(l.installments)));
function checkLoan(l){
  if(!l||!clean(l.name)||clean(l.name).length>100)throw Error('Nombre de cliente inválido.');
  if(!['semanal','quincenal','mensual'].includes(l.frequency))throw Error('Frecuencia inválida.');
  if(!Number.isInteger(int(l.principal))||int(l.principal)<1000||int(l.principal)>1e12)throw Error('Valor prestado inválido.');
  if(!Number.isInteger(int(l.installments))||int(l.installments)<1||int(l.installments)>120)throw Error('Número de cuotas inválido.');
  if(!validDate(l.startDate))throw Error('Fecha del préstamo inválida.');
  if(clean(l.phone).length>25||clean(l.notes).length>500)throw Error('Teléfono o nota demasiado largos.');
}
function checkPayment(p){
  if(!p||!Number.isInteger(int(p.amount))||int(p.amount)<1)throw Error('El abono debe ser positivo.');
  if(!validDate(p.date))throw Error('Fecha de abono inválida.');
  if(clean(p.note).length>250)throw Error('Nota demasiado larga.');
}
function validateBackup(obj){
  if(!obj||!Array.isArray(obj.loans)||!Array.isArray(obj.payments)||
    obj.loans.length>MAX_LOANS||obj.payments.length>200000)throw Error('El respaldo es inválido o demasiado grande.');
  const ids=new Set(),pids=new Set(),paid=new Map();
  for(const l of obj.loans){
    checkLoan(l);
    if(typeof l.id!=='string'||!l.id||l.id.length>160||ids.has(l.id))throw Error('Identificador de préstamo duplicado o inválido.');
    ids.add(l.id);
  }
  for(const p of obj.payments){
    checkPayment(p);
    if(typeof p.id!=='string'||!p.id||p.id.length>160||pids.has(p.id)||!ids.has(p.loanId))throw Error('Pago duplicado o sin préstamo.');
    pids.add(p.id);
    paid.set(p.loanId,(paid.get(p.loanId)||0)+Number(p.amount));
  }
  for(const l of obj.loans)if((paid.get(l.id)||0)>loanTotal(l))throw Error('El respaldo incluye un préstamo con pagos superiores al total.');
  return paid;
}
export function setupCloud(firebaseConfig){
  const firebaseApp=initializeApp(firebaseConfig);
  const auth=getAuth(firebaseApp), db=getFirestore(firebaseApp);
  const userId=()=>{
    if(!auth.currentUser)throw Error('Inicia sesión para guardar tu información.');
    return auth.currentUser.uid;
  };
  const loansRef=()=>collection(db,'users',userId(),'loans');
  const paysRef=()=>collection(db,'users',userId(),'payments');
  const loanRef=id=>doc(db,'users',userId(),'loans',id);
  const payRef=id=>doc(db,'users',userId(),'payments',id);
  async function getData(){
    const [ls,ps]=await Promise.all([getDocs(loansRef()),getDocs(paysRef())]);
    const loans=ls.docs.map(x=>({...x.data(),id:x.id}));
    const payments=ps.docs.map(x=>({...x.data(),id:x.id}));
    return {loans,payments,settings:{alertsActive:false,email:auth.currentUser?.email||''}};
  }
  async function replaceAll(payload){
    const sums=validateBackup(payload);
    const [oldLoans,oldPays]=await Promise.all([getDocs(loansRef()),getDocs(paysRef())]);
    // Borrado por bloques y después importación; hacer respaldo ANTES de restaurar.
    const old=[...oldPays.docs,...oldLoans.docs];
    for(let n=0;n<old.length;n+=300){
      const b=writeBatch(db);
      for(const d of old.slice(n,n+300))b.delete(d.ref);
      await b.commit();
    }
    const entries=[...payload.loans.map(l=>[loanRef(l.id),{
      ...l,phone:clean(l.phone),notes:clean(l.notes),principal:int(l.principal),installments:int(l.installments),paidTotal:sums.get(l.id)||0
    }]),...payload.payments.map(p=>[payRef(p.id),{
      ...p,amount:int(p.amount),note:clean(p.note)
    }])];
    for(let n=0;n<entries.length;n+=300){
      const b=writeBatch(db);
      for(const [ref,data] of entries.slice(n,n+300))b.set(ref,data);
      await b.commit();
    }
  }
  async function applyAction(action,payload){
    if(action==='newLoan'){
      checkLoan(payload);
      const id=crypto.randomUUID();
      await setDoc(loanRef(id),{
        id,name:clean(payload.name),phone:clean(payload.phone),notes:clean(payload.notes),
        principal:int(payload.principal),frequency:payload.frequency,installments:int(payload.installments),
        startDate:payload.startDate,createdAt:new Date().toISOString(),paidTotal:0
      });
    }else if(action==='pay'){
      checkPayment(payload);
      const pId=crypto.randomUUID(),payment={
        id:pId,loanId:payload.loanId,date:payload.date,amount:int(payload.amount),
        note:clean(payload.note),createdAt:new Date().toISOString()
      };
      await runTransaction(db,async tx=>{
        const lr=loanRef(payload.loanId),snap=await tx.get(lr);
        if(!snap.exists())throw Error('Préstamo no encontrado.');
        const l=snap.data(), newPaid=Number(l.paidTotal||0)+payment.amount;
        if(newPaid>loanTotal(l))throw Error('El abono supera el saldo pendiente.');
        tx.update(lr,{paidTotal:newPaid});
        tx.set(payRef(pId),payment);
      });
    }else if(action==='edit'){
      if(!clean(payload.name)||clean(payload.name).length>100||clean(payload.phone).length>25||clean(payload.notes).length>500)
        throw Error('Datos de cliente inválidos.');
      await updateDoc(loanRef(payload.id),{name:clean(payload.name),phone:clean(payload.phone),notes:clean(payload.notes)});
    }else if(action==='deletePayment'){
      await runTransaction(db,async tx=>{
        const pr=payRef(payload.id),paySnap=await tx.get(pr);
        if(!paySnap.exists())throw Error('No se encontró ese abono.');
        const lr=loanRef(paySnap.data().loanId),loanSnap=await tx.get(lr);
        if(!loanSnap.exists())throw Error('No se encontró el préstamo asociado.');
        tx.update(lr,{paidTotal:Math.max(0,Number(loanSnap.data().paidTotal||0)-Number(paySnap.data().amount))});
        tx.delete(pr);
      });
    }else if(action==='deleteLoan'){
      const lr=loanRef(payload.id),snap=await getDoc(lr);
      if(!snap.exists())throw Error('No se encontró ese préstamo.');
      const payments=await getDocs(query(paysRef(),where('loanId','==',payload.id)));
      for(let n=0;n<payments.docs.length;n+=300){
        const b=writeBatch(db);
        for(const p of payments.docs.slice(n,n+300))b.delete(p.ref);
        await b.commit();
      }
      await deleteDoc(lr);
    }else if(action==='restore'){
      await replaceAll(payload);
    }else{
      throw Error('Acción no reconocida.');
    }
    return getData();
  }
  return {
    auth,
    onAuthStateChanged:fn=>onAuthStateChanged(auth,fn),
    signIn:(email,password)=>signInWithEmailAndPassword(auth,email,password),
    signUp:(email,password)=>createUserWithEmailAndPassword(auth,email,password),
    reset:email=>sendPasswordResetEmail(auth,email),
    signOut:()=>signOut(auth),
    call:async (name,...args)=>{
      if(name==='getData')return getData();
      if(name==='applyAction')return applyAction(args[0],args[1]);
      throw Error('Esta función no está disponible en la versión PWA.');
    }
  };
}
