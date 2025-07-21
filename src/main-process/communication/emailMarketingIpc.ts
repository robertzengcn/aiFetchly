import { EmailMarketingController } from "@/controller/emailMarketingController";
import { ipcMain } from 'electron';
import {
  EMAILMARKETINGTEMPLIST, EMAILMARKETINGTEMPREMOVE, EMAILMARKETINGTEMPDETAIL,
  EMAILMARKETINGTEMPUPDATE, EMAILMARKETINGFILTERLIST, EMAILMARKETFILTERDETAIL, EMAILMARKETFILTERUPDATE,
  EMAILSERVICELIST, EMAILSERVICEDETAIL, EMAILSERVICEUPDATE, EMAILSERVICEDELETE, EMAILFILTERDELETE, SENDTESTEMAIL, RECEIVESENDTESTEMAILMESSAGE
} from "@/config/channellist";
import { ItemSearchparam } from "@/entityTypes/commonType"
import { CommonResponse, CommonMessage, CommonIdrequest, CommonDialogMsg } from "@/entityTypes/commonType"
import { EmailTemplatedata, EmailFilterdata, EmailServiceListdata, EmailServiceEntitydata, EmailSendParam, EmailFilterDetialdata } from "@/entityTypes/emailmarketingType"
import { EmailTemplateEntity } from "@/entity/EmailTemplate.entity"
import { EmailFilterEntity } from "@/entity/EmailFilter.entity"
import { EmailTemplateRespdata } from "@/entityTypes/emailmarketingType"
import { EmailFilterDetailEntity } from "@/entity/EmailFilterDetail.entity";
export function registerEmailMarketingIpcHandlers() {

  ipcMain.handle(EMAILMARKETINGTEMPLIST, async (event, arg): Promise<CommonResponse<EmailTemplateRespdata>> => {
    const qdata = JSON.parse(arg) as ItemSearchparam;
    if (!Object.prototype.hasOwnProperty.call(qdata, "page")) {
      qdata.page = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(qdata, "size")) {
      qdata.size = 100;
    }
    const emailmarketCon = new EmailMarketingController()
    const res = await emailmarketCon.listEmailTemplate(qdata.page, qdata.size, qdata.search)
    if (res) {
      if (res.records) {
        const respdata:EmailTemplateRespdata[]=[]
        res.records.forEach((item:EmailTemplateEntity)=>{
          respdata.push({
            TplId:item.id,
            TplTitle:item.title,
            TplContent:item.content,
            TplRecord:item.updatedAt?.toDateString(),
            Status:item.status
          })
        })
        const resp: CommonResponse<EmailTemplateRespdata> = {
          status: true,
          msg: "",
          data: {
            records: respdata,
            num: res.num
          }
        }
        return resp
      } else {
        //data empty
        const resp: CommonResponse<EmailTemplateRespdata> = {
          status: true,
          msg: "",
          data: {
            records: [],
            num: 0
          }
        }
        return resp
      }
    } else {
      const resp: CommonResponse<EmailTemplateRespdata> = {
        status: false,
        msg: "emailmarketing.list_email_template_error",
        data: null
      }
      return resp
    }
  });

  //remove email template
  ipcMain.handle(EMAILMARKETINGTEMPREMOVE, async (event, arg): Promise<CommonMessage<number>> => {
    const qdata = JSON.parse(arg) as CommonIdrequest<string>;
    if (!qdata.id) {
      const resp: CommonMessage<number> = {
        status: false,
        msg: "emailmarketing.template_id_is_required",
      }
      return resp
    }
    const emailmarketCon = new EmailMarketingController()
    const res = await emailmarketCon.removeEmailTemplate(Number(qdata.id))
    // if (res) {
    const resp: CommonMessage<number> = {
      status: true,
      msg: "",
      data: Number(qdata.id)
    }
    return resp
    // } else {
    //   const resp: CommonMessage<CommonIdrequest<number>> = {
    //     status: false,
    //     msg: "emailmarketing.remove_email_template_error",

    //   }
    //   return resp
    // }
  });
  //get email template by id
  ipcMain.handle(EMAILMARKETINGTEMPDETAIL, async (event, arg): Promise<CommonMessage<EmailTemplateRespdata>> => {
    const qdata = JSON.parse(arg) as CommonIdrequest<string>;
    if (!qdata.id) {
      const resp: CommonMessage<EmailTemplateRespdata> = {
        status: false,
        msg: "emailmarketing.template_id_require",
      }
      return resp
    }
    const emailmarketCon = new EmailMarketingController()
    const res = await emailmarketCon.getEmailTemplateDetail(Number(qdata.id))
    if (res) {
      //convert to EmailTemplateRespdata
      const respdata:EmailTemplateRespdata={
        TplId:res.id,
        TplTitle:res.title,
        TplContent:res.content,
        TplRecord:res.updatedAt?.toDateString(),
        Status:res.status,
        TplDescription:res.description?res.description:""
      }
      const resp: CommonMessage<EmailTemplateRespdata> = {
        status: true,
        msg: "",
        data: respdata
      }
      return resp
    } else {
      const resp: CommonMessage<EmailTemplateRespdata> = {
        status: false,
        msg: "emailmarketing.template_item_notexist",
      }
      return resp
    }
  });
  //update email template data
  ipcMain.handle(EMAILMARKETINGTEMPUPDATE, async (event, arg): Promise<CommonMessage<CommonIdrequest<number>>> => {
    const qdata = JSON.parse(arg) as EmailTemplateRespdata;
    const emailmarketCon = new EmailMarketingController()
    const res = await emailmarketCon.updateEmailtemplate(qdata)
    if (res) {
      const resp: CommonMessage<CommonIdrequest<number>> = {
        status: true,
        msg: "",
        data: { id: res }
      }
      return resp
    } else {
      const resp: CommonMessage<CommonIdrequest<number>> = {
        status: false,
        msg: "emailmarketing.update_email_template_error",

      }
      return resp
    }
  })
  ipcMain.handle(EMAILMARKETINGFILTERLIST, async (event, arg): Promise<CommonResponse<EmailFilterdata>> => {
    const qdata = JSON.parse(arg) as ItemSearchparam;
    if (!Object.prototype.hasOwnProperty.call(qdata, "page")) {
      qdata.page = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(qdata, "size")) {
      qdata.size = 100;
    }
    const emailmarketCon = new EmailMarketingController()
    const res = await emailmarketCon.listEmailFilter(qdata.page, qdata.size, qdata.search)
    // console.log(res)
    if (res) {
      //if (res.data) {
      const respdata:EmailFilterdata[]=[]
      
      for (let i = 0; i < res.records.length; i++) {
        const item: EmailFilterEntity = res.records[i];
        //get filter details
        const filterdetails:EmailFilterDetialdata[]=[]
        if(item.filterDetails){
        for (let j = 0; j < item.filterDetails.length; j++) {
          const detail: EmailFilterDetailEntity = item.filterDetails[j];
          filterdetails.push({
            id: detail.id,
            content: detail.content
          })
        }
      }
        respdata.push({
          id: item.id,
          name: item.name,
          description: item.description ? item.description : "",
          filter_details: filterdetails,
          created_time: item.createdAt ? item.createdAt.toISOString().split('T')[0] : ""
          // created_time: item.createdAt ? item.createdAt.toDateString() : ""
        });
      }
      const resp: CommonResponse<EmailFilterdata> = {
        status: true,
        msg: "",
        data: {
          records: respdata,
          num: res.num
        }
      }
      return resp
    } else {
      //data empty
      const resp: CommonResponse<EmailFilterdata> = {
        status: true,
        msg: "",
        data: {
          records: [],
          num: 0
        }
      }
      return resp

      //}
    }

  })
  ipcMain.handle(EMAILMARKETFILTERDETAIL, async (event, arg): Promise<CommonMessage<EmailFilterdata>> => {
    const qdata = JSON.parse(arg) as CommonIdrequest<string>;
    if (!qdata.id) {
      const resp: CommonMessage<EmailFilterdata> = {
        status: false,
        msg: "id_require",
      }
      return resp
    }
    const emailmarketCon = new EmailMarketingController()
    const resp = await emailmarketCon.getEmailFilterDetail(Number(qdata.id))
    if (resp) {
      //get filter details by filter id
      const filterdetails=await emailmarketCon.getEmailFilterDetailByFilterId(Number(qdata.id))
      //convert to EmailFilterdata
      const respdata:EmailFilterdata={
        id:resp.id,
        name:resp.name,
        description:resp.description?resp.description:"",
        filter_details:[],
        created_time:resp.createdAt?resp.createdAt.toDateString():""
      }
      if(filterdetails){
      for (let i = 0; i < filterdetails.length; i++) {
        const detail: EmailFilterDetailEntity = filterdetails[i];
        respdata.filter_details.push({
          id: detail.id,
          content: detail.content
        })
      }
    }
      const resdata: CommonMessage<EmailFilterdata> = {
        status: true,
        msg: "",
        data: respdata
      }
      return resdata
    } else {
      const resdata: CommonMessage<EmailFilterdata> = {
        status: false,
        msg: "emailmarketing.filter_item_notexist",
      }
      return resdata
    }

  })
  //update email filter
  ipcMain.handle(EMAILMARKETFILTERUPDATE, async (event, arg): Promise<CommonMessage<CommonIdrequest<number>>> => {
    const qdata = JSON.parse(arg) as EmailFilterdata;
    const emailmarketCon = new EmailMarketingController()
    const res = await emailmarketCon.updateEmailFilter(qdata)
    console.log(res)
    if (res) {
      const resp: CommonMessage<CommonIdrequest<number>> = {
        status: true,
        msg: "",
        data: {id:res}
      }
      return resp
    } else {
      const resp: CommonMessage<CommonIdrequest<number>> = {
        status: false,
        msg: "emailmarketing.update_email_filter_error",

      }
      return resp
    }
  })
  //delete email filter
  ipcMain.handle(EMAILFILTERDELETE, async (event, arg): Promise<CommonMessage<number>> => {
    const qdata = JSON.parse(arg) as CommonIdrequest<string>;
    if (!qdata.id) {
      const resp: CommonMessage<number> = {
        status: false,
        msg: "Template id is required",
      }
      return resp
    }
    const emailmarketCon = new EmailMarketingController()
    try{
      const res = await emailmarketCon.deleteEmailFilter(Number(qdata.id))
      const resp: CommonMessage<number> = {
        status: true,
        msg: "",
        data: Number(qdata.id)
      }
      return resp
    }catch(error) {
      const resp: CommonMessage<number> = {
        status: false,
        msg: "emailmarketing.delete_email_filter_error",
      }
      return resp
    }
  });

  //email service
  //get email service list
  ipcMain.handle(EMAILSERVICELIST, async (event, arg): Promise<CommonResponse<EmailServiceListdata>> => {
    const qdata = JSON.parse(arg) as ItemSearchparam;
    if (!Object.prototype.hasOwnProperty.call(qdata, "page")) {
      qdata.page = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(qdata, "size")) {
      qdata.size = 100;
    }
    const emailmarketCon = new EmailMarketingController()
    const res = await emailmarketCon.getEmailServiceList(qdata.page, qdata.size, qdata.search)
    console.log(res)
    if (res) {
      if (res.records) {
        const resp: CommonResponse<EmailServiceListdata> = {
          status: true,
          msg: "",
          data: {
            records: res.records,
            num: res.num
          }
        }
        return resp
      } else {
        //data empty
        const resp: CommonResponse<EmailServiceListdata> = {
          status: true,
          msg: "",
          data: {
            records: [],
            num: 0
          }
        }
        return resp
      }
    } else {
      const resp: CommonResponse<EmailServiceListdata> = {
        status: false,
        msg: "emailmarketing.service_list_error",
        data: null
      }
      return resp
    }
  });
  //email service detail
  ipcMain.handle(EMAILSERVICEDETAIL, async (event, arg): Promise<CommonMessage<EmailServiceEntitydata>> => {
    const qdata = JSON.parse(arg) as CommonIdrequest<string>;
    if (!qdata.id) {
      const resp: CommonMessage<EmailServiceEntitydata> = {
        status: false,
        msg: "template_id_require",
      }
      return resp
    }
    const emailmarketCon = new EmailMarketingController()
    const res = await emailmarketCon.getEmailServiceDetail(Number(qdata.id))
    if (res) {
      const resp: CommonMessage<EmailServiceEntitydata> = {
        status: true,
        msg: "",
        data: res
      }
      return resp
    } else {
      const resp: CommonMessage<EmailServiceEntitydata> = {
        status: false,
        msg: "emailmarketing.service_item_notexist",
      }
      return resp
    }
  });
  //create or update email service
  ipcMain.handle(EMAILSERVICEUPDATE, async (event, arg): Promise<CommonMessage<CommonIdrequest<number>>> => {
    const qdata = JSON.parse(arg) as EmailServiceEntitydata;
    const emailmarketCon = new EmailMarketingController()
    const res = await emailmarketCon.createEmailService(qdata)
    console.log(res)
    if (res) {
      const resp: CommonMessage<CommonIdrequest<number>> = {
        status: true,
        msg: "",
        data: { id: res }
      }
      return resp
    } else {
      const resp: CommonMessage<CommonIdrequest<number>> = {
        status: false,
        msg: "emailmarketing.create_email_service_error",

      }
      return resp
    }
  })

  //delete email service
  ipcMain.handle(EMAILSERVICEDELETE, async (event, arg): Promise<CommonMessage<number>> => {
    const qdata = JSON.parse(arg) as CommonIdrequest<string>;
    if (!qdata.id) {
      const resp: CommonMessage<number> = {
        status: false,
        msg: "Template id is required",
      }
      return resp
    }
    const emailmarketCon = new EmailMarketingController()

    const res = await emailmarketCon.deleteEmailService(Number(qdata.id))
    const resp: CommonMessage<number> = {
      status: true,
      msg: "",
      data: Number(qdata.id)
    }
    return resp
  });

  //SEND test email

  ipcMain.on(SENDTESTEMAIL, async (event, arg): Promise<void> => {
    const qdata = JSON.parse(arg) as EmailSendParam;
    // try {
    const emailmarketCon = new EmailMarketingController()
    await emailmarketCon.sendEmail(qdata, (errorMessage: string) => {
      console.log(errorMessage)
      const resp: CommonDialogMsg = {
        status: false,
        code: 202411141455379,
        data: {
          action: "error",
          title: "emailservice.send_test_email_error",
          content: errorMessage
        }
      }
      event.sender.send(RECEIVESENDTESTEMAILMESSAGE, JSON.stringify(resp))
      return
    }, () => {
      // console.log("email send success")
      const resp: CommonDialogMsg = {
        status: true,
        code: 0,
        data: {
          action: "success",
          title: "emailservice.send_test_email_success",
          content: ""
        }
      }
      event.sender.send(RECEIVESENDTESTEMAILMESSAGE, JSON.stringify(resp))
      return resp
    }).catch((error) => {
      console.log(error)
      let errorMessage: string;

      if (error instanceof Error) {
        // If error is an instance of Error, access its message property
        errorMessage = error.message;
      } else {
        // Otherwise, convert error to a string
        errorMessage = String(error);
      }

      const resp: CommonDialogMsg = {
        status: false,
        code: 202411141458415,
        data: {
          action: "error",
          title: "send_test_email_error",
          content: errorMessage
        }
      }
      event.sender.send(RECEIVESENDTESTEMAILMESSAGE, JSON.stringify(resp))
      return resp
    })


  })

}