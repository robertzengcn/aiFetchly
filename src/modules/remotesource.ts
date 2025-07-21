export { };
// import axios from "axios";
//import request from "@/modules/lib/request"
import { HttpClient } from "@/modules/lib/httpclient"
import jwt_decode from "jwt-decode";
import { Token } from "@/modules/token"
// import { decode } from "punycode";
// const debug = require('debug')('RemoteSource');
import {User} from "@/modules/user"
import {TOKENNAME} from '@/config/usersetting';
// const url = require("url");
// const FormData = require('form-data');
type sosetting = {
  sotype: string;
  socialuser: string;
  socialpass: string;
  proxy: {
    proxy: string;
    user: string;
    pass: string;
  },
}
export type Linkdata = {
  id?: number,
  title: string,
  url: string,
  content?: string,
  lang: string,
  socialtask_id: number,
}

export type socialTask = {
  id: number,
  campaign_id: number,
  campaign_name: string,
  tag: string,
  type: string,
  keywords: Array<string>,
  extra_task_info: {
    TaskId: number
    ResulttaskId?: number
  }
}
type configType = {
  REMOTEADD: string,
  REMOTEUSERNAME: string,
  REMOTEPASSWORD: string,
}
type keywordItem = {
  keyword: string,
  tag: string,
  Created: string,
  UsedTime: number,
}
export type jwtUser = {
  // account_id:number
  name: string,
  email: string,
  // token:string
  roles: Array<string>,
}
type jwtTokenUser = {
  AccountId: number,
  Email: string,
  Name: string,
  exp?: number,
  iat?: number,
  iss?: string,
  Roles: Array<string>,
}

export class RemoteSource {
  private tokenname= TOKENNAME;
  // private static instance: RemoteSource;
  REMOTEADD: string;
  // REMOTEUSERNAME: string;
  // REMOTEPASSWORD: string;
  // private _Token:string;
  private _httpClient: HttpClient
  constructor() {

    this._httpClient = new HttpClient();
    // const config = this.readenv();
    // this.REMOTEADD = config.REMOTEADD;
    // this.tokenname="social-market-token"
    // this.REMOTEUSERNAME = config.REMOTEUSERNAME;
    // this.REMOTEPASSWORD = config.REMOTEPASSWORD;
  }

  // public static getInstance(): RemoteSource {
  //   if (!RemoteSource.instance) {
  //     RemoteSource.instance = new RemoteSource();
  //   }
  //   return RemoteSource.instance;
  // }


  // readenv(): configType {
  //   //read config from .env file
  //   const envcofig = this.readConfig();
  //   debug(envcofig)
  //   //check key exist in object
  //   if (!envcofig.hasOwnProperty("REMOTEADD")) {
  //     throw new Error(`REMOTEADD not found in .env file`);
  //   }
  //   if (!envcofig.hasOwnProperty("REMOTEUSERNAME")) {
  //     throw new Error(`USERNAME not found in .env file`);
  //   }
  //   if (!envcofig.hasOwnProperty("REMOTEPASSWORD")) {
  //     throw new Error(`PASSWORD not found in .env file`);
  //   }
  //   return envcofig as configType;
  // }

  /**
   * read config from .env File
   *
   * @returns {object} config
   * */
  readConfig(): object {
    const result = require("dotenv").config();
    if (result.error) {
      throw result.error;
    }
    return result.parsed;
  }

  /**
   * get response from remote servive
   * @return object
   */
  async getRemoteConfig(campaignId): Promise<sosetting | void> {
    // let envconfig = await readenv();

    const sosetvar = this._httpClient.get(
      "/api/getsobyCam/?campaign_id=" + campaignId
    )
      .then(function (res) {
        if (res.status != 200) {
          throw new Error("code not equal 200");
        }
        if (!res.data.status) {
          throw new Error("code not equal 200");
        }
        // console.log(res.status)
        // console.log(res.data.data.user)
        // console.log(res.data.data.pass)
        // console.log(res.data.data.proxy)
        const sosetting = {
          sotype: res.data.data.sotype,
          socialuser: res.data.data.user,
          socialpass: res.data.data.pass,
          proxy: {
            proxy: res.data.data.proxy.url,
            user: res.data.data.proxy.user,
            pass: res.data.data.proxy.pass,
          },
        };
        return sosetting;
      })
      .catch(function (error) {
        console.error(error);
      });

    return sosetvar;

  }


  /**
   * save link to remote servive
   */
  async saveLinkremote(link: Linkdata): Promise<number> {
    const FormData = require('form-data');
    // debug(link)
    let data = new FormData();
    data.append('title', link.title);
    if (link.content) {
      data.append('content', link.content);
    }
    data.append('url', link.url);
    data.append('lang', link.lang);
    if (link.socialtask_id) {
      data.append('socialtask_id', link.socialtask_id);
    }
    // debug(this.REMOTEUSERNAME)
    // debug(this.REMOTEPASSWORD)
    const linkId = this._httpClient.post(
      "/api/savesolink",
      data
    )
      .then(function (res) {
        // debug(res);
        // console.log(res)
        return res.data.data as number;
      })
      .catch(function (error) {
        // console.log(error);
        throw new Error(error.message);
      });
    return linkId;
  }
  //get scrapy info list
  async Getscrapyinfolist(taskId: number, limit: number): Promise<Array<Linkdata> | null> {
    const linkdaarr = this._httpClient.get(
      "/api/getscrapeinfolist?sotaskid=" + taskId + "&limit=" + limit
    ).then(function (res) {
      // debug(res);
      // console.log(res)
      if (res.data.data) {
        return res.data.data as Array<Linkdata>;
      } else {
        return null;
      }
    })
      .catch(function (error) {
        // console.log(error);
        throw new Error(error.message);
      });
    return linkdaarr;
  }
  /**
   * get task info
   * @param taskId 
   */
  async Gettaskinfo(taskId: number): Promise<null | socialTask> {
    const taskInfo = this._httpClient.get(
      "/api/getsocialtaskinfo?task_id=" + taskId,
    ).then(function (res) {
      // debug(res);
      // console.log(res)
      return res.data.data as socialTask;
    })
      .catch(function (error) {
        // console.log(error);
        throw new Error(error.message);
      });
    return taskInfo;
  }
  /**
   * get social task keywords
   * @param taskId 
   * @returns 
   */
  async Gettaskkeywords(taskId: number): Promise<Array<string>> {
    const taskInfo = this._httpClient.get(
      "/api/taskkeyword?task_id=" + taskId,
    ).then(function (res) {
      // debug(res);
      // console.log(res)
      const keywords: Array<string> = [];
      const Keyitemarr = res.data.data as Array<keywordItem>;
      for (const item in Keyitemarr) {

        keywords.push(Keyitemarr[item].keyword)
      }
      return keywords;
    })
      .catch(function (error) {
        // console.log(error);
        throw new Error(error.message);
      });
    return taskInfo;
  }
  async Updateprocesstime(scropeId: number) {
    const FormData = require('form-data');
    const data = new FormData();
    data.append('id', scropeId);

    await this._httpClient.post(
      "/api/updatescrapeprotime",
      data,
    ).then(function (res) {
      // debug(res);
      // console.log(res)
      // return res.data.data as number;
    })
      .catch(function (error) {
        // console.log(error);
        throw new Error(error.message);
      });
  }
  //login user
  async Login(username: string, password: string): Promise<jwtUser> {
    // const FormData = require('form-data');
    var data = new FormData();
    data.append('username', username);
    data.append('password', password);
    //console.log(Array.from(data));
    const thisobj = this

    const loginInfo = await this._httpClient.post(
      "/user/login",
      data, 
    ).then(function (res) {
      // if (res.status != 200) {
      //   throw new Error(res.statusText);
      // }
      if (!res.status) {
        throw new Error(res.msg);
      }
      //decode jwt token
      const decoded = thisobj.ValidateToken(res.data.Token);
      if (decoded.name&&decoded.name.length>0) {
        const tokenModel = new Token()
        tokenModel.setValue(thisobj.tokenname, res.data.Token)
      }
      // console.log(decoded)
      return decoded;
      //return res.data.Token as {token:string};
    })
      .catch(function (error) {
        // console.log(error);
        throw new Error(error.message);
      });
    return loginInfo;
  }
  //get user info use token
  async GetUserInfo(): Promise<jwtUser | null> {
    const tokenModel = new Token()
    //console.log("token name:"+this.tokenname)

    const token = tokenModel.getValue(this.tokenname);
    //const thisobj=this
    if (token == null || token.length < 1) {
      return null;
    }
    // console.log("token is:" + token)

    const loginInfo = await this._httpClient.get(
     "/api/user/info",
   ).then(function (res) {
      // console.log(res);
      
      if (res.status == false) {
        if(res.code==403){
        //remove token
        const userModel=new User()
        userModel.Signout()
        }
        throw new Error(res.msg);
      }

      //const decoded = thisobj.ValidateToken(token);
      return res.data;
      //return res.data.Token as {token:string};
    })
      .catch(function (error) {
        // console.log(error);
        throw new Error(error.message);
      });
    return loginInfo;
  }
  //validate jwt token 
  public ValidateToken(token: string): jwtUser {
    //console.log(token)
    const decoded = jwt_decode(token) as jwtTokenUser;
    //console.log(decoded)
    const jwtuser: jwtUser = {
      // account_id: decoded.AccountId,
      email: decoded.Email,
      name:decoded.Name,
      // token:token,
      roles: decoded.Roles ? decoded.Roles : [],
    }
    return jwtuser;
  }
  //remove token in remote
  public async removeRemoteToken(): Promise<void>{
    const loginInfo = await this._httpClient.get(
      "/api/user/signout",
    ).then(function (res) {
       // console.log(res);
       
       if (res.status == false) {
         throw new Error(res.msg);
       }
       
       //const decoded = thisobj.ValidateToken(token);
      //  return res.data;
       //return res.data.Token as {token:string};
     })
       .catch(function (error) {
         // console.log(error);
         throw new Error(error.message);
       });
  }
}

