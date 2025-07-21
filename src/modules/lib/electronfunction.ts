import {USERSDBPATH} from '@/config/usersetting';
import { Token } from "@/modules/token"
export function getUserdbpath(){
    const tokenService=new Token()
    const dbpath=tokenService.getValue(USERSDBPATH)
    if(dbpath.length<=0){
        throw new Error('db path not found')
    }
    return dbpath
}