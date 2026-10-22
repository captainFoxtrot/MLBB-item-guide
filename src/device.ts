import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Store } from './db.js';
export const secret=()=>randomBytes(32).toString('base64url');
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export function matches(plain:string|undefined, hashed:string):boolean {
 if(!plain||plain.length>256)return false;
 const a=Buffer.from(digest(plain),'hex'),b=Buffer.from(hashed,'hex');
 return timingSafeEqual(a,b);
}
export function authorizeOwner(store:Store,id:string,authorization:string|undefined){
 const device=store.getDevice(id);return device&&matches(authorization?.replace(/^Bearer\s+/i,''),device.owner_hash)?device:undefined;
}
