import { Token } from "@/modules/token"
import { RemoteSource } from "@/modules/remotesource"
import {USERSDBPATH,TOKENNAME,USERLOGPATH, USEREMAIL,USERNAME} from '@/config/usersetting';
export class User {
    //private tokenname= "social-market-token";
    public async Signout(){
        try {
            const remoteModel = new RemoteSource()
            await remoteModel.removeRemoteToken()
        } catch (error) {
            console.error("Error removing remote token:", error);
            // Continue with local cleanup even if remote token removal fails
        }
        
        const token = new Token();
        token.setValue(TOKENNAME, "");
        token.setValue(USERSDBPATH, "");
        token.setValue(USERSDBPATH, "");
        token.setValue(USERLOGPATH, "");
        token.setValue(USEREMAIL, "");
        token.setValue(USERNAME, "");
    }
}