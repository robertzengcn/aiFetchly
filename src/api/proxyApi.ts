export { };
import { HttpClient } from "@/modules/lib/httpclient";
import { ProxylistResp, ProxyEntity, SaveProxyResp, ProxyParseItem, ImportProxyResp, GetProxyCountResp, ProxyListEntity } from "@/entityTypes/proxyType";
import { CommonApiresp } from "@/entityTypes/commonType";
import { IProxyApi } from "@/modules/interface/IProxyApi";

export class ProxyApi implements IProxyApi {
  private _httpClient: HttpClient;
  constructor() {
    this._httpClient = new HttpClient();
  }
  //get proxy list
  public async getProxylist(page: number,
    size: number,
    search: string): Promise<ProxylistResp> {
    const searchParams: Record<string, any> = new URLSearchParams();
    searchParams.append("page", page);
    searchParams.append("size", size);

    if (search.length > 0) {
      searchParams.append("search", search);
    }
    // const params = new URLSearchParams({page: page, pagesize: "100"}).toString();
    const paramstring = searchParams.toString();
    // const finalurl='/api/campaign?'+paramstring;
    const finalurl = "/api/proxy/list?" + paramstring;

    const proxylistres = await this._httpClient.get(finalurl);
    if (!proxylistres) {
      throw new Error("remote return empty");
    }
    // console.log("campaign list is following")
    // console.log(campignlistres.data)
    const proxylistEn: ProxyListEntity[] = []
    if (proxylistres.status) {
      if (proxylistres.data.records) {
        const plist = proxylistres.data.records as ProxyEntity[]
        //convert data to ProxyListEntity
        plist.forEach((item) => {
          const ple: ProxyListEntity = {
            id: item.id,
            host: item.host,
            port: item.port,
            username: item.user,
            password: item.pass,
            protocol: item.protocol,
            country_code: item.country_code,
            addtime: "",
          }
          if (item.addtime) {
            ple.addtime = item.addtime
          }
          proxylistEn.push(ple)
        })
      }
    }
      const resp: ProxylistResp = {
        status: proxylistres.status,
        msg: proxylistres.msg,
        data: {
          total: proxylistres.data.total,
          records: proxylistEn,
        },
      };
      return resp;
    }
  //delete proxy from api
  public async deleteProxy(id: number): Promise<any> {

    const searchParams: Record<string, any> = new URLSearchParams();
    searchParams.append("id", id);
    const paramstring = searchParams.toString();
    const finalurl = "/api/proxy/delete?" + paramstring;
    const resp = await this._httpClient.delete(finalurl);
    if (!resp) {
      throw new Error("remote return empty");
    }
    return resp;
  }
  //get proxy detail from api
  public async getProxyDetail(id: number): Promise<CommonApiresp<ProxyEntity>> {
    const searchParams: Record<string, any> = new URLSearchParams();
    searchParams.append("id", id);
    const paramstring = searchParams.toString();
    const finalurl = "/api/proxy?" + paramstring;

    const resp = await this._httpClient.get(finalurl, { id: id });
    if (!resp) {
      throw new Error("remote return empty");
    }
    return resp;
  }
  //save proxy
  public async saveProxy(entity: ProxyEntity): Promise<SaveProxyResp> {
    let data = new FormData();
    if (entity.id) {
      data.append("Id", entity.id.toString());
    }
    if (entity.host) {
      data.append("Host", entity.host);
    }
    if (entity.port) {
      data.append("Port", entity.port);
    }
    if (entity.user) {
      data.append("User", entity.user);
    }
    if (entity.pass) {
      data.append("Pass", entity.pass);
    }
    if (entity.protocol) {
      data.append("Protocol", entity.protocol);
    }
    if (entity.country_code) {
      data.append("CountryCode", entity.country_code);
    }

    const resp = await this._httpClient.post("/api/proxy/save", data);
    if (!resp) {
      throw new Error("remote return empty");
    }
    return resp;
  }
  //import proxy list into server
  public async importProxy(data: Array<ProxyParseItem>): Promise<ImportProxyResp> {
    const resp = await this._httpClient.postJson("/api/proxy/import", data);
    if (!resp) {
      throw new Error("remote return empty");
    }
    return resp as ImportProxyResp;
  }

  public async getProxycount(): Promise<number> {
    const resp = await this._httpClient.get("/api/proxy/count") as GetProxyCountResp;
    if (!resp) {
      throw new Error("remote return empty");
    }
    if (resp.status) {
      return resp.data.total
    } else {
      throw new Error(resp.msg)
    }

  }
}