export type HttpClientOptions = {
    headers?:HeadersInit;
}
// export type FetchOptions = {
//     headers?: HeadersInit;
// }
//import { AuthInterceptor } from '@/modules/lib/authInterceptor';
import {Token} from "@/modules/token"
import {TOKENNAME, REFRESHTOKEN} from '@/config/usersetting';
import { User } from '@/modules/user';
import { TokenRefreshService } from '@/modules/tokenRefresh';

// export type RemoteResp = {
//   status: boolean,
//   msg: string,
//   data?: any,
// }
export class HttpClient {
    private _headers: HeadersInit = {};
    private baseUrl: string;
    private _tokenRefreshService: TokenRefreshService;
    private _refreshInProgress = false;
    constructor() {
      //AuthInterceptor()
      this.baseUrl = import.meta.env.VITE_LOGIN_URL+"/apis";
      this._tokenRefreshService = new TokenRefreshService();
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

    /**
     * Refresh token and retry the original request
     * Prevents infinite loops by checking if refresh is already in progress
     */
    private async _refreshTokenAndRetry(
      endpoint: string,
      options: RequestInit,
      isRetry = false
    ): Promise<any> {
      // Prevent infinite refresh loops
      if (isRetry) {
        // Already retried once, sign out user
        console.warn('Token refresh failed after retry, signing out user');
        try {
          const userModel = new User();
          await userModel.removeToken();
        } catch (error) {
          console.error('Error during signout:', error);
        }
        delete this._headers['Authorization'];
        throw new Error('Authentication failed: Token expired. Please login again.');
      }

      // Check if refresh is already in progress
      if (this._refreshInProgress) {
        // Wait a bit and retry the original request
        await new Promise(resolve => setTimeout(resolve, 500));
        return this._fetchJSON(endpoint, options);
      }

      this._refreshInProgress = true;

      try {
        // Attempt to refresh the token
        const refreshResult = await this._tokenRefreshService.refreshAccessToken();
        
        if (refreshResult.status && refreshResult.data) {
          // Update access token in headers
          this.setHeader('Authorization', 'Bearer ' + refreshResult.data.accessToken);
          
          // Retry the original request with new token
          return this._fetchJSON(endpoint, options);
        } else {
          throw new Error('Token refresh failed');
        }
      } catch (error) {
        console.error('Token refresh error:', error);
        
        // Sign out user on refresh failure
        try {
          const userModel = new User();
          await userModel.removeToken();
        } catch (signoutError) {
          console.error('Error during signout:', signoutError);
        }
        
        delete this._headers['Authorization'];
        throw new Error('Authentication failed: Token expired. Please login again.');
      } finally {
        this._refreshInProgress = false;
      }
    }
  
    public async _fetchJSON(endpoint:string, options:RequestInit, isRetry = false): Promise<any> {
      // await this.setheaderToken()
      const res = await fetch(this.baseUrl+endpoint,
        {...options,
          headers: this._headers,
        }
       );
       
      // Handle 403 Forbidden - Token expired
      if (res.status === 403) {
        console.warn('Received 403 Forbidden - Attempting token refresh');
        
        // Check if refresh token exists
        const tokenModel = new Token();
        const refreshToken = tokenModel.getValue(REFRESHTOKEN);
        
        if (refreshToken && refreshToken.trim().length > 0) {
          // Try to refresh token and retry request
          return this._refreshTokenAndRetry(endpoint, options, isRetry);
        } else {
          // No refresh token available, sign out user
          console.warn('No refresh token available, signing out user');
          try {
            const userModel = new User();
            await userModel.removeToken();
          } catch (error) {
            console.error('Error during signout:', error);
          }
          
          delete this._headers['Authorization'];
          throw new Error('Authentication failed: Token expired. Please login again.');
        }
      }
       
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
      //console.log(this._headers)
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

    // post json data and return stream response
    public async postStream(endpoint:string, data, options = {}, isRetry = false): Promise<Response> {
      const res = await fetch(this.baseUrl + endpoint, {
        ...options,
        body: JSON.stringify(data),
        method: "POST",
        headers: {
          ...this._headers,
          'Accept': 'text/event-stream',
          'Content-Type': 'application/json'
        },
      });
      
      // Handle 403 Forbidden - Token expired
      if (res.status === 403) {
        console.warn('Received 403 Forbidden - Attempting token refresh');
        
        // Prevent infinite refresh loops
        if (isRetry) {
          console.warn('Token refresh failed after retry, signing out user');
          try {
            const userModel = new User();
            await userModel.removeToken();
          } catch (error) {
            console.error('Error during signout:', error);
          }
          delete this._headers['Authorization'];
          throw new Error('Authentication failed: Token expired. Please login again.');
        }

        // Check if refresh token exists
        const tokenModel = new Token();
        const refreshToken = tokenModel.getValue(REFRESHTOKEN);
        
        if (refreshToken && refreshToken.trim().length > 0) {
          // Check if refresh is already in progress
          if (this._refreshInProgress) {
            await new Promise(resolve => setTimeout(resolve, 500));
            return this.postStream(endpoint, data, options, true);
          }

          this._refreshInProgress = true;

          try {
            // Attempt to refresh the token
            const refreshResult = await this._tokenRefreshService.refreshAccessToken();
            
            if (refreshResult.status && refreshResult.data) {
              // Update access token in headers
              this.setHeader('Authorization', 'Bearer ' + refreshResult.data.accessToken);
              
              // Retry the original request with new token
              return this.postStream(endpoint, data, options, true);
            } else {
              throw new Error('Token refresh failed');
            }
          } catch (error) {
            console.error('Token refresh error:', error);
            
            // Sign out user on refresh failure
            try {
              const userModel = new User();
              await userModel.removeToken();
            } catch (signoutError) {
              console.error('Error during signout:', signoutError);
            }
            
            delete this._headers['Authorization'];
            throw new Error('Authentication failed: Token expired. Please login again.');
          } finally {
            this._refreshInProgress = false;
          }
        } else {
          // No refresh token available, sign out user
          console.warn('No refresh token available, signing out user');
          try {
            const userModel = new User();
            await userModel.removeToken();
          } catch (error) {
            console.error('Error during signout:', error);
          }
          
          delete this._headers['Authorization'];
          throw new Error('Authentication failed: Token expired. Please login again.');
        }
      }
      
      if (!res.ok) throw new Error(res.statusText);
      return res;
    }
  }
  
  export default HttpClient;