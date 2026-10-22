import webpush from 'web-push';
import type { Store } from './db.js';
import type { PushDelivery } from './coach.js';
export function createPush(store:Store){
 const pub=process.env.VAPID_PUBLIC_KEY||'',priv=process.env.VAPID_PRIVATE_KEY||'';
 if(pub&&priv)webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',pub,priv);
 async function notify(token:string,title:string,body:string):Promise<PushDelivery>{
  const rows=store.getSubscriptions(token),out:PushDelivery={enabled:!!(pub&&priv),attempted:0,delivered:0,failed:0,expired:0,errors:[]};
  if(!out.enabled){out.errors.push('VAPID keys not configured');return out;}
  for(const row of rows){out.attempted++;
   try{await webpush.sendNotification(JSON.parse(row.subscription),JSON.stringify({title,body:body.slice(0,180),url:`/game/${token}`}),{TTL:180});out.delivered++;}
   catch(e:any){out.failed++;const code=Number(e?.statusCode)||0;
    if(code===404||code===410){store.deleteSubscription(row.endpoint);out.expired++;}
    const message=`HTTP ${code||'?'}: ${String(e?.message||'push error').slice(0,160)}`;
    out.errors.push(message);console.warn('Push delivery failed:',message);
   }
  }
  console.info('Push delivery summary:',JSON.stringify({tokenSuffix:token.slice(-4),...out}));
  return out;
 }
 return {publicKey:pub,enabled:!!(pub&&priv),notify};
}
