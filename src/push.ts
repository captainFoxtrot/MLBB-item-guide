import webpush from 'web-push';
import type { Store } from './db.js';
export function createPush(store:Store){
 const pub=process.env.VAPID_PUBLIC_KEY||'';const priv=process.env.VAPID_PRIVATE_KEY||'';
 if(pub&&priv)webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',pub,priv);
 return {publicKey:pub,enabled:!!(pub&&priv),async notify(token:string,text:string){if(!pub||!priv)return;
  for(const row of store.getSubscriptions(token)){
   try{await webpush.sendNotification(JSON.parse(row.subscription),JSON.stringify({title:'MLBB Item Coach',body:text.slice(0,200),url:`/game/${token}`}),{TTL:120});}
   catch(e:any){if(e.statusCode===404||e.statusCode===410)store.deleteSubscription(row.endpoint);else console.warn('Push failed',e.message);}
  }
 }};
}
