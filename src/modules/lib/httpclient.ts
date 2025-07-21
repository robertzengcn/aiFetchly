export type HttpClientOptions = {
    headers?:HeadersInit;
}
// export type FetchOptions = {
//     headers?: HeadersInit;
// }
//import { AuthInterceptor } from '@/modules/lib/authInterceptor';
import {Token} from "@/modules/token"
import {TOKENNAME} from '@/config/usersetting';
// export type RemoteResp = {
//   status: boolean,
//   msg: string,
//   data?: any,
// }
export class HttpClient {
    private _headers: HeadersInit = {};
    private baseUrl: string;
    constructor() {
      //AuthInterceptor()
      this.baseUrl = import.meta.env.VITE_REMOTEADD;
      this.setheaderToken()
      // const tokenModel=new Token()
      // const tokenval=tokenModel.getValue("social-market-token")
      // if (tokenval) {
      //   //config.headers.Authorization = 'Bearer ' + tokenval
      //   this.setHeader('Authorization', 'Bearer ' + tokenval)
      // }
    }

    public setheaderToken(){
      const tokenModel=new Token()
      const tokenval=tokenModel.getValue(TOKENNAME)
      //console.log("prepare to set token:"+tokenval)
      if (tokenval) {
        //config.headers.Authorization = 'Bearer ' + tokenval
        this.setHeader('Authorization', 'Bearer ' + tokenval)
      }
    }
  
    public async _fetchJSON(endpoint:string, options:RequestInit): Promise<any> {
      // await this.setheaderToken()
      const res = await fetch(this.baseUrl+endpoint,
        {...options,
          headers: this._headers,
        }
       );
       
      if (!res.ok) throw new Error(res.statusText);
  
    //   if (options.parseResponse !== false && res.status !== 204)
    //     return res.json();
    const data = await res.json();
    //console.log(data)
      return data;
    }
  
    setHeader(key, value) {
      this._headers[key] = value;
      return this;
    }
  
    getHeader(key) {
      return this._headers[key];
    }
  
    setBasicAuth(username, password) {
      this._headers['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`;
      return this;
    }
  
    setBearerAuth(token) {
      this._headers['Authorization'] = `Bearer ${token}`;
      return this;
    }
  
    public async get(endpoint:string, options = {}): Promise<any> {
      // const body = new URLSearchParams(params).toString();  
      console.log(this._headers)
      return this._fetchJSON(endpoint, {
        ...options,
        method: "GET",
        // headers: this._headers,
      });
    }
  
    public async post(endpoint:string, formData:FormData, options = {}): Promise<any>{
        // const body=new URLSearchParams(formData)
        // const body=formData
        // var requestOptions = {
        //   method: 'POST',
        //   headers: this._headers,
        //   body: formData,
          
        // };
        // return fetch("http://localhost:8082/user/login", requestOptions)
        // .then(response => {return response.json()})
        // const postheader={'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'}
        // let mergedhead = {...this._headers, ...postheader};
        return this._fetchJSON(endpoint, {
        ...options,
        // headers: this._headers,
        body: formData,
        method: "POST"
      });
    }
  
    public async put(endpoint:string, data): Promise<any> {
      console.log(JSON.stringify(data))  
      return this._fetchJSON(endpoint, {
        // headers: this._headers,
        body: data ? JSON.stringify(data) : undefined,
        method: "PUT",
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
      });
    }
  
    public async patch(endpoint:string, operations, options = {}): Promise<any> {
      return this._fetchJSON(endpoint, {
        ...options,
        body: JSON.stringify(operations),
        method: "PATCH",
        // headers: this._headers,
      });
    }
  
    public async delete(endpoint:string, options = {}) {
      return this._fetchJSON(endpoint, {
        ...options,
        method: "DELETE",
        // headers: this._headers,
      });
    }
    // post json data
    public async postJson(endpoint:string, data, options = {}): Promise<any> {
      // this.setHeader('Accept', 'application/json')
      // this.setHeader('Content-Type', 'application/json')
      return this._fetchJSON(endpoint, {
        ...options,
        body: JSON.stringify(data),
        method: "POST",
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        // headers: this._headers,
      });
    }
  }
  
  export default HttpClient;